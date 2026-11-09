import { expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import { parseApprovedIndependentSourceVerification } from './source-verification';
it('rejects caller declared authority and digest-valid unapproved manifests',()=>{const manifest_json=JSON.stringify({version:1,verified:true});expect(parseApprovedIndependentSourceVerification({version:1,manifest_json,manifest_sha256:createHash('sha256').update(manifest_json).digest('hex')})).toBeNull();expect(parseApprovedIndependentSourceVerification({verified:true})).toBeNull();});
