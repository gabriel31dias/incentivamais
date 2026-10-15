import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { IsNull, Repository } from 'typeorm';
import { ImportBatch, Session, User } from './entities';

/** o que a pessoa que subiu a planilha vê no modal de devolução */
const returnedPayload = (b: ImportBatch) => ({
  id: b.id,
  fileName: b.fileName,
  competence: b.competence,
  distributorName: b.distributorName,
  reason: b.returnReason,
  returnedByName: b.returnedByName,
  returnedAt: b.returnedAt,
});

/**
 * Tempo real (Socket.IO): cada usuário logado entra na sala user:<id>.
 * Autentica com o mesmo token da API (handshake.auth.token).
 */
// ponytail: sessão revogada não derruba o socket já aberto; checar a cada evento se isso importar
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('Realtime');
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(ImportBatch) private readonly batches: Repository<ImportBatch>,
  ) {}

  async handleConnection(socket: Socket) {
    const userId = await this.authenticate(socket.handshake.auth?.token);
    if (!userId) return socket.disconnect(true);
    socket.data.userId = userId;
    await socket.join(`user:${userId}`);
    // devolvido enquanto a pessoa estava offline: aparece assim que ela conecta
    const pending = await this.batches.find({ where: { userId, status: 'returned', returnSeenAt: IsNull() }, order: { id: 'ASC' } });
    for (const b of pending) socket.emit('import:returned', returnedPayload(b));
  }

  /** a pessoa fechou o modal: não mostra de novo */
  @SubscribeMessage('import:returned:seen')
  async seen(@ConnectedSocket() socket: Socket, @MessageBody() id: number) {
    if (!socket.data.userId || !Number.isInteger(id)) return;
    await this.batches.update({ id, userId: socket.data.userId, returnSeenAt: IsNull() }, { returnSeenAt: new Date() });
  }

  notifyReturned(batch: ImportBatch) {
    this.server.to(`user:${batch.userId}`).emit('import:returned', returnedPayload(batch));
  }

  private async authenticate(token?: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: number; sid: number; mfa?: boolean }>(String(token));
      if (payload.mfa || !Number.isInteger(payload.sid)) return null;
      const [user, session] = await Promise.all([
        this.users.findOneBy({ id: payload.sub }),
        this.sessions.findOneBy({ id: payload.sid, revokedAt: IsNull() }),
      ]);
      return user && session && !user.blocked && user.status === 'active' ? user.id : null;
    } catch {
      return null;
    }
  }
}
