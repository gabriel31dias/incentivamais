import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { forMe } from './app-menu.controller';
import { AuthUser, CurrentUser } from './auth';
import { Menu, PointEntry, QuizAttempt, RecordItem } from './entities';
import { menuAllows } from './menu-access';

class SubmitDto {
  @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) answers: number[];
}

class VoteDto {
  @IsInt() @Min(0) option: number;
}

type Question = { q: string; options: string[]; correct: number };
/** folga para a rede: o app envia sozinho quando o tempo acaba */
const GRACE_MS = 15_000;
const today = () => new Date().toISOString().slice(0, 10);
const inPeriod = (d: { startDate?: string; endDate?: string }) => (!d.startDate || d.startDate <= today()) && (!d.endDate || d.endDate >= today());
const questionsOf = (d: Record<string, unknown>): Question[] =>
  (Array.isArray(d.questions) ? d.questions : [])
    .map((x) => ({ q: String(x?.q ?? ''), options: (Array.isArray(x?.options) ? x.options : []).map(String).filter((o: string) => o.trim()), correct: Number(x?.correct ?? 0) }))
    .filter((x) => x.q.trim() && x.options.length >= 2);
const passPctOf = (d: Record<string, unknown>) => Number(d.passPct) || 70;

/**
 * Quiz e enquetes do app (tela /quiz). A correção é feita aqui: as respostas certas não vão
 * para o app antes do envio. Pontos do quiz entram no extrato uma única vez, ao passar.
 */
@Controller('app/me')
export class QuizController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(QuizAttempt) private readonly attempts: Repository<QuizAttempt>,
  ) {}

  private async assertMenu(user: AuthUser) {
    if (!(await menuAllows(this.menus, user, '/quiz'))) throw new ForbiddenException('Seu perfil não tem acesso a esta tela.');
  }

  /** quiz/enquete publicado, no período e para o público do usuário */
  private async record(m: EntityManager, user: AuthUser, id: number, kind: 'quiz' | 'poll') {
    const r = await m.findOneBy(RecordItem, { id, kind, status: 'published' });
    if (!r || !forMe(user, r.data) || !inPeriod(r.data)) throw new NotFoundException(kind === 'quiz' ? 'Quiz não disponível' : 'Enquete não disponível');
    return r;
  }

  /** tentativa aberta cujo tempo acabou vira tentativa zerada */
  private expired(a: QuizAttempt, timeLimit: number) {
    return !a.finishedAt && timeLimit > 0 && Date.now() - new Date(a.startedAt).getTime() > timeLimit * 1000 + GRACE_MS;
  }

  @Get('quizzes')
  async list(@CurrentUser() user: AuthUser) {
    await this.assertMenu(user);
    const rows = (await this.db.getRepository(RecordItem).find({ where: [{ kind: 'quiz', status: 'published' }, { kind: 'poll', status: 'published' }], order: { id: 'DESC' } }))
      .filter((r) => forMe(user, r.data) && inPeriod(r.data));
    const mine = await this.attempts.findBy({ userId: user.id });
    const of = (id: number) => mine.filter((a) => a.recordId === id);
    return {
      quizzes: rows
        .filter((r) => r.kind === 'quiz')
        .map((r) => {
          const tries = of(r.id);
          const timeLimit = Number(r.data.timeLimit) || 0;
          const finished = tries.filter((a) => a.finishedAt || this.expired(a, timeLimit));
          const best = finished.sort((a, b) => b.score - a.score)[0];
          const attempts = Number(r.data.attempts) || 1;
          const passed = finished.some((a) => a.passed);
          return {
            id: r.id,
            title: r.title,
            points: Number(r.data.points) || 0,
            questions: questionsOf(r.data).length,
            timeLimit,
            attempts,
            used: tries.length,
            passPct: passPctOf(r.data),
            endDate: r.data.endDate ?? null,
            best: best ? { score: best.score, total: best.total } : null,
            passed,
            inProgress: tries.some((a) => !a.finishedAt && !this.expired(a, timeLimit)),
            canPlay: !passed && (tries.length < attempts || tries.some((a) => !a.finishedAt && !this.expired(a, timeLimit))),
          };
        }),
      polls: rows
        .filter((r) => r.kind === 'poll')
        .map((r) => {
          const vote = of(r.id)[0];
          const options: string[] = (Array.isArray(r.data.options) ? r.data.options : []).map(String).filter((o: string) => o.trim());
          return { id: r.id, title: r.title, options, myVote: vote?.answers?.[0] ?? null, votes: vote ? options.map((_, i) => Number(r.data.votes?.[i]) || 0) : null };
        }),
    };
  }

  /** começa (ou retoma) uma tentativa e devolve as perguntas sem a resposta certa */
  @Post('quizzes/:id/start')
  @HttpCode(200)
  async start(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.assertMenu(user);
    return this.db.transaction(async (m) => {
      const r = await this.record(m, user, id, 'quiz');
      const qs = questionsOf(r.data);
      if (!qs.length) throw new BadRequestException('Este quiz ainda não tem perguntas válidas (cada uma precisa de pelo menos 2 alternativas). Avise o administrador.');
      const timeLimit = Number(r.data.timeLimit) || 0;
      const tries = await m.findBy(QuizAttempt, { userId: user.id, recordId: id });
      if (tries.some((a) => a.passed)) throw new ConflictException('Você já passou neste quiz.');
      let a = tries.find((x) => !x.finishedAt && !this.expired(x, timeLimit));
      if (!a) {
        if (tries.length >= (Number(r.data.attempts) || 1)) throw new ConflictException('Suas tentativas acabaram.');
        a = await m.save(m.create(QuizAttempt, { userId: user.id, recordId: id, answers: null, total: qs.length }));
      }
      const left = timeLimit ? Math.max(0, Math.round((timeLimit * 1000 + new Date(a.startedAt).getTime() - Date.now()) / 1000)) : null;
      return { title: r.title, secondsLeft: left, questions: qs.map(({ q, options }) => ({ q, options })) };
    });
  }

  @Post('quizzes/:id/submit')
  @HttpCode(200)
  async submit(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: SubmitDto) {
    await this.assertMenu(user);
    return this.db.transaction(async (m) => {
      const r = await this.record(m, user, id, 'quiz');
      const qs = questionsOf(r.data);
      const timeLimit = Number(r.data.timeLimit) || 0;
      const tries = await m.findBy(QuizAttempt, { userId: user.id, recordId: id });
      const a = tries.find((x) => !x.finishedAt);
      if (!a) throw new ConflictException('Nenhuma tentativa em andamento. Comece o quiz de novo.');
      const late = this.expired(a, timeLimit);
      const results = qs.map((q, i) => !late && body.answers[i] === q.correct);
      a.answers = body.answers.slice(0, qs.length);
      a.score = results.filter(Boolean).length;
      a.total = qs.length;
      a.passed = a.score * 100 >= passPctOf(r.data) * qs.length;
      a.finishedAt = new Date();
      await m.save(a);
      let earned = 0;
      const points = Number(r.data.points) || 0;
      const bonusKey = `QUIZ:${id}:U${user.id}`;
      if (a.passed && points > 0 && !(await m.existsBy(PointEntry, { bonusKey }))) {
        await m.insert(PointEntry, {
          sellerId: user.id,
          sellerName: user.name,
          distributorId: user.distributorId ?? null,
          campaignId: null,
          type: 'bonus',
          points,
          origin: `Quiz: ${r.title}`,
          bonusKey,
          reason: `${a.score}/${a.total} acertos`,
          actorName: user.name,
        });
        earned = points;
      }
      const attemptsLeft = Math.max(0, (Number(r.data.attempts) || 1) - tries.length);
      // gabarito só quando não dá mais para tentar (senão viraria cola para a próxima tentativa)
      return { score: a.score, total: a.total, passed: a.passed, late, earned, results, attemptsLeft, correct: a.passed || !attemptsLeft ? qs.map((q) => q.correct) : null };
    });
  }

  @Post('polls/:id/vote')
  @HttpCode(200)
  async vote(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: VoteDto) {
    await this.assertMenu(user);
    return this.db.transaction(async (m) => {
      const r = await this.record(m, user, id, 'poll');
      const options: string[] = (Array.isArray(r.data.options) ? r.data.options : []).map(String).filter((o: string) => o.trim());
      if (body.option >= options.length) throw new BadRequestException('Opção inválida');
      if (await m.existsBy(QuizAttempt, { userId: user.id, recordId: id })) throw new ConflictException('Você já votou nesta enquete.');
      await m.save(m.create(QuizAttempt, { userId: user.id, recordId: id, answers: [body.option], total: 1, finishedAt: new Date() }));
      const votes = options.map((_, i) => (Number(r.data.votes?.[i]) || 0) + (i === body.option ? 1 : 0));
      await m.update(RecordItem, id, { data: { ...r.data, votes } });
      return { myVote: body.option, votes };
    });
  }
}
