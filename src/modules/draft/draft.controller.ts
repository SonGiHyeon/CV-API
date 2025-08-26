import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DraftService } from './draft.service';

@Controller('drafts')
export class DraftController {
    constructor(private readonly svc: DraftService) { }

    /** 초안 생성 */
    @Post()
    async create(@Body() body: any) {
        const { company, position, jd, tone, authorId } = body ?? {};
        if (!company || !position || !jd) {
            return { ok: false, message: 'company, position, jd는 필수입니다.' };
        }
        return this.svc.createDraft({ company, position, jd, tone, authorId });
    }

    /** 기여도 계산 → Attribution 저장 + 미리보기 반환 */
    @Post(':id/attribution')
    async compute(@Param('id') id: string, @Body() body: any) {
        const topK = body?.topK ?? 50;
        const threshold = body?.threshold ?? 0;   // 기본 0
        const n = body?.n === 2 ? 2 : 3;          // 2 또는 3
        const fallbackTo2 = body?.fallbackTo2 ?? true;
        return this.svc.computeAttribution(id, { topK, threshold, n, fallbackTo2 });
    }

    /** 초안 확정 → RewardLedger에 preview 금액 기록 */
    @Post(':id/finalize')
    async finalize(@Param('id') id: string) {
        return this.svc.finalizeDraft(id);
    }

    /** (선택) 정산 실행 → preview → settled */
    @Post(':id/settle')
    async settle(@Param('id') id: string) {
        return this.svc.settleDraftRewards(id);
    }

    /** 내 보상 조회 (예: /drafts/rewards/me?userId=dataset-owner) */
    @Get('rewards/me')
    async myRewards(@Query('userId') userId?: string) {
        if (!userId) return { ok: false, message: 'userId 필요' };
        return this.svc.getRewardsForUser(userId);
    }
}
