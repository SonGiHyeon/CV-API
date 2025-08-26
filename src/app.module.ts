// src/app.module.ts
import { Module } from '@nestjs/common';
import { DatasetModule } from './modules/dataset/dataset.module'; // 기존에 있던 모듈
import { DraftModule } from './modules/draft/draft.module';       // ★ 추가

@Module({
  imports: [
    DatasetModule,
    DraftModule,     // ★ 여기 추가
  ],
})
export class AppModule { }
