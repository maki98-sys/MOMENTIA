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
    if(Object.keys(value).some(key=>!['workerId','limit'].includes(key)) || typeof value.workerId!=='string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(value.workerId)) throw new UnauthorizedException('Invalid worker claim fields.');
    const limit=value.limit===undefined?10:Number(value.limit);
    if(!Number.isInteger(limit)||limit<1||limit>50) throw new UnauthorizedException('limit must be between 1 and 50.');
    return this.processing.claim(value.workerId,limit);
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
    if(typeof value.workerId!=='string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(value.workerId)) throw new UnauthorizedException('workerId is required.');
    const {workerId,...result}=value;
    return this.processing.complete(workerId,jobId,result);
  }

  @Post('deletions/claim')
  claimDeletions(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Worker claim body is required.');
    const value=body as Record<string,unknown>;
    if(Object.keys(value).some(key=>!['workerId','limit','ownerUserId'].includes(key)) || typeof value.workerId!=='string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(value.workerId)) throw new UnauthorizedException('Invalid worker claim fields.');
    const limit=value.limit===undefined?50:Number(value.limit);
    if(!Number.isInteger(limit)||limit<1||limit>100) throw new UnauthorizedException('limit must be between 1 and 100.');
    if(value.ownerUserId!==undefined && typeof value.ownerUserId!=='string') throw new UnauthorizedException('Invalid ownerUserId.');
    return this.processing.claimDeletions(value.workerId,limit,value.ownerUserId as string|undefined);
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
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Invalid cleanup payload.');
    const value=body as Record<string,unknown>;
    if(Object.keys(value).some(key=>key!=='limit')) throw new UnauthorizedException('Unsupported cleanup fields.');
    const limit=value.limit===undefined?100:Number(value.limit);
    if(!Number.isInteger(limit)||limit<1||limit>500) throw new UnauthorizedException('limit must be between 1 and 500.');
    return this.processing.cleanupExpiredUploads(limit);
  }

  @Post('leases/recover')
  recover(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new UnauthorizedException('Invalid lease recovery payload.');
    const value=body as Record<string,unknown>;
    if(Object.keys(value).some(key=>key!=='staleSeconds')) throw new UnauthorizedException('Unsupported lease recovery fields.');
    const staleSeconds=value.staleSeconds===undefined?300:Number(value.staleSeconds);
    if(!Number.isInteger(staleSeconds)||staleSeconds<60||staleSeconds>3600) throw new UnauthorizedException('staleSeconds must be between 60 and 3600.');
    return this.processing.releaseStaleLocks(staleSeconds);
  }
}
