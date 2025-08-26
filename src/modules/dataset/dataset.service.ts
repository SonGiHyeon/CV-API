// src/modules/dataset/dataset.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class DatasetService {
    private prisma = new PrismaClient();

    // 리포트/문서 저장 폴더
    private reportsDir = path.join(process.cwd(), 'reports'); // ./reports
    private docsDir = path.join(process.cwd(), 'docs');       // ./docs

    // ---- 합성용 샘플 문장 풀 ----
    private pool = [
        '사용자 문제를 빠르게 파악하고 해결책을 제시했습니다.',
        '데이터를 기반으로 성과 지표를 개선한 경험이 있습니다.',
        '팀과 협업하여 서비스 품질을 향상시켰습니다.',
        '업무 자동화를 통해 처리 시간을 단축했습니다.',
        '고객 관점에서 메시지를 재구성했습니다.',
        '실패 경험을 바탕으로 재발 방지 프로세스를 만들었습니다.',
        '핵심 지표를 정의하고 주기적으로 점검했습니다.',
        '문제의 원인을 구조적으로 분석했습니다.',
        '테스트를 통해 가설을 빠르게 검증했습니다.',
        '책임감을 가지고 끝까지 과제를 완수했습니다.',
    ];

    private async ensureDir(p: string) {
        try { await fs.mkdir(p, { recursive: true }); } catch { }
    }

    private randomPara(): string {
        const n = 2 + Math.floor(Math.random() * 4); // 2~5문장
        const pick = Array.from({ length: n }, () => this.pool[Math.floor(Math.random() * this.pool.length)]);
        return pick.join(' ');
    }

    // ========== 1) 합성 ==========
    async synthesize(targetChunks = 200) {
        const owner = await this.prisma.user.upsert({
            where: { pseudoId: 'dataset-owner' },
            update: {},
            create: { pseudoId: 'dataset-owner' },
        });

        let totalChunks = 0;
        let essayCount = 0;

        while (totalChunks < targetChunks) {
            const essay = await this.prisma.essay.create({ data: { userId: owner.id } });
            essayCount++;

            const k = 2 + Math.floor(Math.random() * 4); // 2~5개 청크
            const chunksData = Array.from({ length: k }, () => ({
                essayId: essay.id,
                text: this.randomPara(),
                valid: true,
            }));

            await this.prisma.chunk.createMany({ data: chunksData });
            totalChunks += k;
        }

        const sample = await this.prisma.chunk.findFirst({ select: { id: true, text: true } });
        return { essays: essayCount, chunksCreated: totalChunks, sample };
    }

    // 검증 규칙
    private banned = [
        /([0-9]{3}-[0-9]{4}-[0-9]{4})/g, // 전화번호
        /@/g,                             // 이메일 기호
        /(주민등록번호|신용카드|비밀번호)/g,
    ];
    private runValidate(t: string) {
        const lenOk = (t?.trim().length || 0) >= 20;
        const bannedHit = this.banned.some((re) => re.test(t));
        return { lenOk, bannedHit, ok: lenOk && !bannedHit };
    }

    // CSV 유틸
    private toCsv(rows: Array<Record<string, string | number | boolean>>) {
        if (!rows.length) return '';
        const headers = Object.keys(rows[0]);
        const esc = (v: any) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const head = headers.join(',');
        const body = rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
        return `${head}\n${body}\n`;
    }

    // ========== 2) 검증 + 리포트 저장 ==========
    async validateAll({ save = false, format = 'csv' as 'csv' | 'json' } = {}) {
        const chunks = await this.prisma.chunk.findMany({ select: { id: true, text: true } });

        let pass = 0, fail = 0;
        let failLen = 0, failBanned = 0;

        const details: Array<{ chunk_id: string; too_short: boolean; banned_hit: boolean; valid: boolean; text_len: number }> = [];

        await this.prisma.$transaction(async (tx) => {
            for (const c of chunks) {
                const v = this.runValidate(c.text);
                if (v.ok) {
                    pass++;
                    await tx.chunk.update({ where: { id: c.id }, data: { valid: true } });
                } else {
                    fail++;
                    if (!v.lenOk) failLen++;
                    if (v.bannedHit) failBanned++;
                    await tx.chunk.update({ where: { id: c.id }, data: { valid: false } });
                }
                details.push({
                    chunk_id: c.id,
                    too_short: !v.lenOk,
                    banned_hit: v.bannedHit,
                    valid: v.ok,
                    text_len: c.text?.trim().length || 0,
                });
            }
        });

        const summary = {
            total: chunks.length,
            pass,
            fail,
            reasons: { tooShort: failLen, bannedTokens: failBanned },
            generatedAt: new Date().toISOString(),
        };

        let savedPath: string | null = null;
        if (save) {
            await this.ensureDir(this.reportsDir);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            if (format === 'csv') {
                const csv = this.toCsv(details);
                savedPath = path.join(this.reportsDir, `validation_report_${stamp}.csv`);
                await fs.writeFile(savedPath, csv, 'utf8');
                await fs.writeFile(
                    path.join(this.reportsDir, `validation_summary_${stamp}.json`),
                    JSON.stringify(summary, null, 2),
                    'utf8',
                );
            } else {
                savedPath = path.join(this.reportsDir, `validation_report_${stamp}.json`);
                await fs.writeFile(savedPath, JSON.stringify({ summary, details }, null, 2), 'utf8');
            }
        }

        return { ...summary, reportSaved: !!save, reportPath: savedPath };
    }

    // ========== 3) 통계 ==========
    async stats() {
        const [total, valid, invalid] = await Promise.all([
            this.prisma.chunk.count(),
            this.prisma.chunk.count({ where: { valid: true } }),
            this.prisma.chunk.count({ where: { valid: false } }),
        ]);
        return { total, valid, invalid };
    }

    // ========== 4) 리포트 목록 ==========
    async listReports() {
        await this.ensureDir(this.reportsDir);
        const files = await fs.readdir(this.reportsDir);
        return files
            .filter(f => f.startsWith('validation_report_') || f.startsWith('validation_summary_'))
            .sort()
            .map(name => ({ name, path: path.join('reports', name) }));
    }

    // ========== 5) 데이터 딕셔너리 & README ==========
    async writeDataDocs() {
        await this.ensureDir(this.docsDir);

        const dictPath = path.join(this.docsDir, 'DATA_DICTIONARY.md');
        const readmePath = path.join(this.docsDir, 'README_DATASET.md');

        const dataDictionary = `# Data Dictionary (MVP)

## Tables

### User
| Field     | Type     | Description                |
|---------- |----------|----------------------------|
| id        | String   | PK (cuid)                  |
| pseudoId  | String   | 익명 사용자 식별자(Unique) |
| createdAt | DateTime | 생성일시                   |

### Essay
| Field     | Type     | Description                  |
|---------- |----------|------------------------------|
| id        | String   | PK (cuid)                    |
| userId    | String   | FK -> User.id (소유자/기여자)|
| createdAt | DateTime | 생성일시                     |

### Chunk
| Field     | Type     | Description                             |
|---------- |----------|-----------------------------------------|
| id        | String   | PK (cuid)                               |
| essayId   | String   | FK -> Essay.id                          |
| text      | String   | 문단 텍스트(2~5문장)                    |
| valid     | Boolean  | 검증 통과 여부(true=통과)               |
| createdAt | DateTime | 생성일시                                |

## Generated Files
- reports/validation_report_*.csv : chunk별 검증 결과 (chunk_id, too_short, banned_hit, valid, text_len)
- reports/validation_summary_*.json : 통계 요약 (total, pass, fail, reasons, generatedAt)

## Validation Rules (MVP)
- 길이(Trim 기준) 20자 미만: invalid
- 금지어/패턴: 전화번호(000-0000-0000), '@'(이메일), '주민등록번호', '신용카드', '비밀번호' 포함 시 invalid
`;

        const readme = `# Dataset README (MVP)

이 폴더는 합성 자기소개서 데이터셋과 검증 결과에 대한 문서를 포함합니다.

## 생성 절차 (Sprint 1)
1. **합성**: POST /dataset/synthesize?count=250
2. **검증**: POST /dataset/validate?save=true&format=csv
3. **통계**: GET /dataset/stats

## 주의사항
- 실제 개인정보/식별자는 포함하지 마세요.
- 금지어/패턴은 MVP 기준으로 단순화되어 있으며, 운영 시 확장 필요.
- 임베딩/유사도 계산은 Sprint 2 이후에 추가.

## 필드 정의
자세한 필수 필드는 DATA_DICTIONARY.md 참고.
`

        await fs.writeFile(dictPath, dataDictionary, 'utf8');
        await fs.writeFile(readmePath, readme, 'utf8');

        return { ok: true, dictPath: 'docs/DATA_DICTIONARY.md', readmePath: 'docs/README_DATASET.md' };
    }
}

