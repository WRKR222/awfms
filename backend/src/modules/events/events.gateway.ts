import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATION_CREATED_EVENT,
  DASHBOARD_REFRESH_EVENT,
} from '../../common/events/app-event-bus';

// Socket extended with authenticated user data attached on connection
interface AuthSocket extends Socket {
  userId?: string;
  userRole?: string;
}

/**
 * PW-02 — Real-time WebSocket Gateway
 *
 * Events emitted to clients:
 *   notification:new       — a new in-app notification was created for this user
 *   tally:updated          — an EggTallyVerification changed state
 *   production:new         — a new egg collection session was approved
 *   verification:pending   — a new flock/feed entry is awaiting manager approval
 *   dashboard:refresh      — generic signal to refetch dashboard data
 *
 * Rooms:
 *   user:{userId}           — per-user room for targeted notifications
 *   role:MANAGER            — all active managers
 *   role:OWNER              — all active owners/directors
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/ws',
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // ── Connection lifecycle ────────────────────────────────────────────────────

  async handleConnection(client: AuthSocket) {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect(true);
        return;
      }

      const payload = this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      }) as { sub: string; role: string };

      // Store user info on socket for later use
      client.userId = payload.sub;
      client.userRole = payload.role;

      // Join user-specific and role-specific rooms
      client.join(`user:${payload.sub}`);
      client.join(`role:${payload.role}`);

      this.logger.log(`WS connected: ${payload.sub} (${payload.role})`);
      client.emit('connected', { userId: payload.sub, role: payload.role });
    } catch {
      // Invalid or expired token
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthSocket) {
    const userId = client.userId;
    if (userId) this.logger.log(`WS disconnected: ${userId}`);
  }

  // ── Client → Server messages ────────────────────────────────────────────────

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: AuthSocket) {
    client.emit('pong', { ts: Date.now() });
  }

  // ── Server → Client emitters (called by services) ──────────────────────────

  /** Notify a specific user of a new notification */
  emitNotification(userId: string, notification: {
    id: string; type: string; title: string; message: string;
  }) {
    this.server.to(`user:${userId}`).emit('notification:new', notification);
  }

  /** Notify all users of a role */
  emitToRole(role: string, event: string, data: unknown) {
    this.server.to(`role:${role}`).emit(event, data);
  }

  /** Broadcast a tally state change to MANAGER, SALES, STORE, and OWNER */
  emitTallyUpdate(tallyId: string, status: string) {
    const data = { tallyId, status, ts: Date.now() };
    ['MANAGER', 'SALES', 'STORE', 'OWNER'].forEach(role =>
      this.server.to(`role:${role}`).emit('tally:updated', data),
    );
  }

  /** Signal Manager and Owner dashboards to refresh */
  emitDashboardRefresh(roles: string[] = ['MANAGER', 'OWNER']) {
    roles.forEach(role =>
      this.server.to(`role:${role}`).emit('dashboard:refresh', { ts: Date.now() }),
    );
  }

  /** New production session approved */
  emitProductionUpdate(sessionId: string) {
    this.emitToRole('MANAGER', 'production:new', { sessionId, ts: Date.now() });
    this.emitToRole('OWNER',   'production:new', { sessionId, ts: Date.now() });
  }

  /** New pending verification for Manager */
  emitVerificationPending(entryId: string, entryType: string) {
    this.emitToRole('MANAGER', 'verification:pending', { entryId, entryType, ts: Date.now() });
  }

  // ── Internal event bus listeners ────────────────────────────────────────────

  @OnEvent(NOTIFICATION_CREATED_EVENT)
  handleNotificationCreated(payload: {
    userId: string; id: string; type: string; title: string; message: string;
  }) {
    this.server.to(`user:${payload.userId}`).emit('notification:new', {
      id: payload.id,
      type: payload.type,
      title: payload.title,
      message: payload.message,
    });
  }

  @OnEvent(DASHBOARD_REFRESH_EVENT)
  handleDashboardRefresh(payload: { roles: string[] }) {
    payload.roles.forEach(role =>
      this.server.to(`role:${role}`).emit('dashboard:refresh', { ts: Date.now() }),
    );
  }
}
