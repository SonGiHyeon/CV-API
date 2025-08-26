# Data Dictionary (MVP)

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
