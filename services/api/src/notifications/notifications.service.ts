import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string, cursor?: string, limit = 30, unreadOnly = false) {
    const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 100);
    if (cursor !== undefined && (Number.isNaN(Date.parse(cursor)) || !Number.isFinite(Date.parse(cursor)))) {
      throw new BadRequestException('cursor must be a valid ISO date-time.');
    }

    const result = await this.db.query(
      `SELECT id, category, payload, read_at, created_at
       FROM notifications
       WHERE user_id = $1
         AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
         AND ($3::boolean = false OR read_at IS NULL)
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [userId, cursor ?? null, unreadOnly, pageSize],
    );

    const unread = await this.db.query(
      `SELECT count(*)::int AS count FROM notifications
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );

    return {
      items: result.rows,
      unreadCount: Number(unread.rows[0]?.count ?? 0),
      nextCursor: result.rows.length === pageSize
        ? new Date(String(result.rows[result.rows.length - 1].created_at)).toISOString()
        : null,
    };
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.db.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2
       RETURNING id, category, payload, read_at, created_at`,
      [notificationId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('Notification not found.');
    return result.rows[0];
  }

  async markAllRead(userId: string) {
    const result = await this.db.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { updated: result.rowCount ?? 0 };
  }
}
