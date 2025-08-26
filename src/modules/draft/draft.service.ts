// src/modules/draft/draft.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { jaccardN } from './similarity.util';

type CreateDraftInput = {
    authorId?: string;
    company: string;
    position: string;
    jd: string;
    tone?: 'neutral' | 'formal' | 'friendly';
};

@Injectable()
export class DraftService {
    private prisma = new PrismaClient();

    // 간단 id 생성기 (cuid/uuid 대신 임시)
    private rid(prefix: string) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;


    }

    // 간단 템플릿 생성기 (AI 없이 규칙 기반)
    private makeText({ company, position, jd, tone = 'neutral' }: CreateDraftInput) {
        const toneLine =
            tone === 'formal'
                ? '정확성과 책임감을 바탕으로 결과를 약속드립니다.'
                : tone === 'friendly'
                    ? '협업을 중시하고, 명확한 커뮤니케이션으로 팀에 기여하겠습니다.'
                    : '문제를 구조적으로 분석하고 빠르게 실행합니다.';

        return [
            `안녕하세요. ${company}의 ${position} 포지션 지원자입니다.`,
            `JD 요약: ${jd}`,
            `관련 경험과 강점: 핵심 지표를 정의하고 개선한 경험, 자동화로 처리시간 단축, 협업 기반 품질 향상.`,
            toneLine,
            `감사합니다.`,
        ].join('\n\n');
    }

    // Draft 생성
    async createDraft(input: CreateDraftInput) {
        const id = `d_${Date.now()}`; // TEXT PK → 앱에서 생성
        const text = this.makeText(input);

        const draft = await this.prisma.draft.create({
            data: {
                id,
                authorId: input.authorId ?? null, // @map("author_id")
                company: input.company,
                position: input.position,
                jd: input.jd,
                tone: input.tone ?? 'neutral',
                text,
                status: 'preview',
            },
        });

        return {
            draftId: draft.id,
            text: draft.text,
            meta: {
                company: draft.company,
                position: draft.position,
                tone: draft.tone,
                status: draft.status,
                createdAt: draft.createdAt,
            },
        };
    }

    /**
     * n‑gram 자카드 유사도 기반 기여도 계산
     * - 기본 3‑gram, 매칭 없으면 2‑gram 폴백(기본 true), threshold 기본 0
     * - 기여자(에세이의 userId)별 가중치 집계 → 정규화(합=1.0) → Attribution 저장
     */
    async computeAttribution(
        draftId: string,
        opts?: { topK?: number; threshold?: number; n?: 2 | 3; fallbackTo2?: boolean },
    ) {
        const topK = opts?.topK ?? 50;
        const n = (opts?.n ?? 3) as 2 | 3;          // 기본 3-gram
        const THRESH = opts?.threshold ?? 0;        // 기본 0으로 완화
        const FALLBACK = opts?.fallbackTo2 ?? true; // 3gram 결과 없으면 2gram 폴백

        // 1) 드래프트/청크 로드
        const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
        if (!draft?.text) throw new Error('Draft not found or empty text');

        const chunks = await this.prisma.chunk.findMany({
            where: { valid: true },
            select: { id: true, text: true, essayId: true },
        });

        // 내부 함수: 주어진 n, threshold로 스코어링
        const scoreOnce = (gramN: 2 | 3, threshold: number) => {
            const scored: Array<{ chunkId: string; essayId: string; sim: number }> = [];
            for (const c of chunks) {
                const sim = jaccardN(draft.text!, c.text, gramN);
                if (sim > 0) scored.push({ chunkId: c.id, essayId: c.essayId, sim });
            }
            scored.sort((a, b) => b.sim - a.sim);
            const kept = scored.slice(0, topK).filter((s) => s.sim >= threshold);
            const avg = kept.length ? kept.reduce((acc, v) => acc + v.sim, 0) / kept.length : 0;
            return { kept, avg };
        };

        // 2) 시도 1: n-gram(기본 3), 시도 2: 필요 시 2-gram
        let gramUsed: 2 | 3 = n;
        let { kept, avg } = scoreOnce(n, THRESH);
        if (kept.length === 0 && FALLBACK && n === 3) {
            gramUsed = 2;
            ({ kept, avg } = scoreOnce(2, THRESH));
        }

        // 3) 기여자 가중치 집계 (w = sim - THRESH)
        const weightsByContributor = new Map<string, number>();
        for (const s of kept) {
            const essay = await this.prisma.essay.findUnique({
                where: { id: s.essayId },
                select: { userId: true },
            });
            if (!essay?.userId) continue;
            const w = s.sim - THRESH;
            weightsByContributor.set(
                essay.userId,
                (weightsByContributor.get(essay.userId) || 0) + w,
            );
        }

        // 4) 정규화 & 저장
        await this.prisma.attribution.deleteMany({ where: { draftId } });

        const totalW = Array.from(weightsByContributor.values()).reduce((a, b) => a + b, 0);
        const normalized =
            totalW > 0
                ? Array.from(weightsByContributor.entries()).map(([contributorId, w]) => ({
                    contributorId,
                    weight: w,
                    normWeight: w / totalW,
                }))
                : [];

        if (normalized.length) {
            await this.prisma.$transaction(
                normalized.map((nItem) =>
                    this.prisma.attribution.create({
                        data: {
                            id: this.rid('attr'),
                            draftId,
                            contributorId: nItem.contributorId,
                            chunkId: null,
                            similarity: null,
                            weight: nItem.weight,
                            normWeight: nItem.normWeight,
                        },
                    }),
                ),
            );
        }

        // 5) 보상 미리보기
        const R = 100;
        const preview = normalized
            .map((nItem) => ({
                contributorId: nItem.contributorId,
                points: Math.round(nItem.normWeight * R * 10) / 10,
            }))
            .filter((x) => x.points >= 0.5)
            .sort((a, b) => b.points - a.points)
            .slice(0, 5);

        return {
            draftId,
            headerBadges: {
                gramUsed, // 사용된 n-gram
                refCount: kept.length,
                avgSimilarity: Number(avg.toFixed(3)),
                contributorCount: normalized.length,
            },
            rewardPreview: { total: R, top5: preview },
            topK: kept.slice(0, 10),
        };
    }

    // ---------- DraftService 내부에 추가 ----------

    /**
     * 초안 확정: Draft.status = 'finalized'
     * Attribution.normWeight 를 바탕으로 RewardLedger.amount_preview 생성/갱신
     * - R = 100p
     * - 소수 첫째 자리 반올림(0.1p 단위)
     * - 0.5p 미만 제외
     * - 상한 60p
     */
    async finalizeDraft(draftId: string) {
        const draft = await this.prisma.draft.findUnique({ where: { id: draftId } });
        if (!draft) throw new Error('Draft not found');

        // 1) 이미 finalized면 미리보기 원장만 갱신
        if (draft.status !== 'finalized') {
            await this.prisma.draft.update({
                where: { id: draftId },
                data: { status: 'finalized' },
            });
        }

        // 2) Attribution 불러오기
        const attrs = await this.prisma.attribution.findMany({
            where: { draftId },
            select: { contributorId: true, normWeight: true },
        });

        // 3) 금액 계산
        const R = 100; // 총 리워드
        const cap = 60; // 상한 60p
        const rows = attrs
            .map((a) => ({
                contributorId: a.contributorId,
                points: a.normWeight ? Math.round(a.normWeight * R * 10) / 10 : 0,
            }))
            .filter((x) => x.points >= 0.5)
            .map((x) => ({ ...x, points: Math.min(x.points, cap) }));

        // 4) 원장 upsert (preview)
        // (draftId + contributorId) 조합으로 upsert
        await this.prisma.$transaction(
            rows.map((r) =>
                this.prisma.rewardLedger.upsert({
                    where: { id: `${draftId}_${r.contributorId}` }, // id는 TEXT니까 규칙적으로
                    update: {
                        amountPreview: r.points,
                        status: 'preview',
                    },
                    create: {
                        id: `${draftId}_${r.contributorId}`,
                        draftId,
                        contributorId: r.contributorId,
                        amountPreview: r.points,
                        status: 'preview',
                    },
                }),
            ),
        );

        return {
            ok: true,
            draftId,
            status: 'finalized',
            count: rows.length,
            previewTotal: rows.reduce((a, b) => a + b.points, 0),
            sample: rows.slice(0, 5),
        };
    }

    /** 정산 실행: preview → settled (amountSettled = amountPreview) */
    async settleDraftRewards(draftId: string) {
        // 미리보기 있는 행만 정산
        const rows = await this.prisma.rewardLedger.findMany({
            where: { draftId, status: 'preview' },
            select: { id: true, amountPreview: true },
        });

        if (!rows.length) {
            return { ok: true, draftId, settled: 0 };
        }

        await this.prisma.$transaction(
            rows.map((r) =>
                this.prisma.rewardLedger.update({
                    where: { id: r.id },
                    data: {
                        amountSettled: r.amountPreview,
                        status: 'settled',
                    },
                }),
            ),
        );

        return { ok: true, draftId, settled: rows.length };
    }

    /** 내 보상 조회: 간단 리스트 + 합계 */
    async getRewardsForUser(userId: string) {
        const list = await this.prisma.rewardLedger.findMany({
            where: { contributorId: userId },
            select: {
                draftId: true,
                amountPreview: true,
                amountSettled: true,
                status: true,
            },
            orderBy: { draftId: 'desc' },
        });

        const totals = list.reduce(
            (acc, r) => {
                acc.preview += Number(r.amountPreview || 0);
                acc.settled += Number(r.amountSettled || 0);
                return acc;
            },
            { preview: 0, settled: 0 },
        );

        return { userId, totals, list };
    }

}
