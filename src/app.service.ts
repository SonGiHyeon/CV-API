import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class AppService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
    console.log('✅ Database connected successfully');

    // 테스트: 유저 1명 생성
    const user = await this.user.create({
      data: { pseudoId: 'test-user' },
    });
    console.log('Inserted user:', user);
  }

  getHello(): string {
    return 'Hello World!';
  }
}
