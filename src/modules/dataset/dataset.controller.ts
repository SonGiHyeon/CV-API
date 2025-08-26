// src/modules/dataset/dataset.controller.ts
import { Controller, Post, Query, Get } from '@nestjs/common';
import { DatasetService } from './dataset.service';

@Controller('dataset')
export class DatasetController {
    constructor(private readonly dataset: DatasetService) { }

    // POST /dataset/synthesize?count=250
    @Post('synthesize')
    async synthesize(@Query('count') count?: string) {
        const target = Math.max(1, Math.min(Number(count ?? 200), 2000));
        return this.dataset.synthesize(target);
        //            ^^^^^^^^^^^  <-- 에러 사라져야 함
    }

    // POST /dataset/validate?save=true&format=csv
    @Post('validate')
    async validateAll(@Query('save') save?: string, @Query('format') format?: 'csv' | 'json') {
        return this.dataset.validateAll({ save: save === 'true', format: (format ?? 'csv') as any });
    }

    // GET /dataset/stats
    @Get('stats')
    async stats() {
        return this.dataset.stats();
        //            ^^^^^
    }

    // GET /dataset/reports
    @Get('reports')
    async reports() {
        return this.dataset.listReports();
    }

    // POST /dataset/docs
    @Post('docs')
    async writeDocs() {
        return this.dataset.writeDataDocs();
    }
}
