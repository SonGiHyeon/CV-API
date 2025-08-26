# Dataset README (MVP)

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
