import 'dotenv/config';
import { Logger, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditController, DemoController, LookupsController, MfaController, ProfilesController, SessionsController } from './admin.controller';
import { AppMenuController } from './app-menu.controller';
import { AuthController, AuthGuard } from './auth';
import { CampaignsController, PointsController, RulesController } from './campaigns.controller';
import { DashboardController, ReportsController } from './dashboard.controller';
import { ENTITIES, Profile } from './entities';
import { ImportsController, ImportWorker } from './imports.controller';
import { MenusController } from './menus.controller';
import { QuizController } from './quiz.controller';
import { DistributorsController, TeamsController, UsersController } from './people.controller';
import { RealtimeGateway } from './realtime';
import { RecordsController } from './records.controller';
import { DEMO_PASSWORD, seed } from './seed';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH ?? 'data.sqlite',
      entities: ENTITIES,
      // ponytail: synchronize no lugar de migrations (protótipo); migrations antes de produção
      synchronize: true,
    }),
    TypeOrmModule.forFeature(ENTITIES),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'demo-incentiva', signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [
    AuthController,
    LookupsController,
    ProfilesController,
    AuditController,
    SessionsController,
    DemoController,
    MfaController,
    RecordsController,
    UsersController,
    DistributorsController,
    TeamsController,
    CampaignsController,
    RulesController,
    PointsController,
    ImportsController,
    MenusController,
    AppMenuController,
    QuizController,
    DashboardController,
    ReportsController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, ImportWorker, RealtimeGateway],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const db = app.get(DataSource);
  if (!(await db.getRepository(Profile).count())) {
    const log = new Logger('Seed');
    log.log('Banco vazio: gerando dados fictícios (10.000 usuários)...');
    await seed(db);
    log.warn(`Pronto. Login: admin@incentiva.demo / ${DEMO_PASSWORD}`);
  }
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3333);
}
void bootstrap();
