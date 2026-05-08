-- CreateTable
CREATE TABLE "password_reset_logs" (
    "id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "reset_type" TEXT NOT NULL DEFAULT 'ADMIN_RESET',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "password_reset_logs" ADD CONSTRAINT "password_reset_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_logs" ADD CONSTRAINT "password_reset_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
