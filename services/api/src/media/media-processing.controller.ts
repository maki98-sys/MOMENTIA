import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { MediaProcessingService } from './media-processing.service';

@Controller('internal/media-processing')
export class MediaProcessingController {
  constructor(private readonly processing: MediaProcessingService) {}

  private authorize(token?: string) {
    const expected=process.env.MEDIA_WORKER_TOKEN??'';
    if(!expected || !token) throw new UnauthorizedException('Worker authentication is not configured.');
    const suppliedBuffer=Buffer.from(token);
    const expectedBuffer=Buffer.from(expected);
    if(suppliedBuffer.length!==expectedBuffer.length || !timingSafeEqual(suppliedBuffer,expectedBuffer)) {
      throw new UnauthorizedException('Invalid worker credentials.');
    }
  }

  @Post('jobs/claim')
  claim(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Worker claim body is required.');
    const value=body as Record<string,unknown>;
    if(typeof value.workerId!=='string') throw new UnauthorizedException('workerId is required.');
    return this.processing.claim(value.workerId,Number(value.limit)||10);
  }

  @Post('jobs/:jobId/complete')
  complete(
    @Headers('x-worker-token') token: string | undefined,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Worker result is required.');
    const value=body as Record<string,unknown>;
    if(typeof value.workerId!=='string') throw new UnauthorizedException('workerId is required.');
    const {workerId,...result}=value;
    return this.processing.complete(workerId,jobId,result);
  }

  @Post('deletions/claim')
  claimDeletions(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Worker claim body is required.');
    const value=body as Record<string,unknown>;
    if(typeof value.workerId!=='string') throw new UnauthorizedException('workerId is required.');
    return this.processing.claimDeletions(
      value.workerId,
      Number(value.limit)||50,
      typeof value.ownerUserId==='string'?value.ownerUserId:undefined,
    );
  }

  @Post('deletions/:deletionId/complete')
  completeDeletion(
    @Headers('x-worker-token') token: string | undefined,
    @Param('deletionId') deletionId: string,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Worker result is required.');
    const value=body as Record<string,unknown>;
    if(typeof value.workerId!=='string') throw new UnauthorizedException('workerId is required.');
    const {workerId,...result}=value;
    return this.processing.completeDeletion(workerId,deletionId,result);
  }


  @Post('uploads/cleanup-expired')
  cleanupExpiredUploads(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    const value=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
    return this.processing.cleanupExpiredUploads(Number(value.limit)||100);
  }

  @Post('leases/recover')
  recover(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    const value=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
    return this.processing.releaseStaleLocks(Number(value.staleSeconds)||300);
  }
}
