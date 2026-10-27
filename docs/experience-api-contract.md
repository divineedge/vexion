# Product experience API contract

All staff endpoints use the existing verified staff session. No caller identity headers are trusted.

GET `/api/experience` and GET `/api/experience/admin` use generated `useGetExperienceHub` / `useGetExperienceAdmin`. Admin is software-owner only.

Hub result:
- `threads`: `{id,tenantId,userId,kind:"problem"|"feature"|"help",title,status:"received"|"planned"|"in_progress"|"released"|"resolved",priority:"low"|"normal"|"high",assigneeId:number|null,duplicateOf:string|null,createdAt,updatedAt,diagnostics}`. Ordinary staff see only their own threads.
- `messages`: `{id,threadId,userId,body,internal,attachments:string[],createdAt}`. Internal replies never reach ordinary staff.
- `content`: `{id,kind:"help"|"release",title,body,published,updatedAt}`; staff see published entries only. Plain text, never raw HTML.
- `onboarding`: `{completedSteps:string[],checks:{key,label,complete:boolean,href}[]}`. Company owners/managers can mark steps via action; checklist automatic evidence does not change when a manual step is checked.
- `alerts`: `{id,tenantId:number|null,source,severity,message,resolved,updatedAt}`. Company owners/managers only see own-company alerts.
- `isManager:boolean`, `isSoftwareOwner:boolean`.

Admin adds `businesses` array `{id,name,policy:{subscriptionRequired,trialUntil:string|null,graceDays:number,enforceLimits:boolean},subscriptionStatus,planId,maxUsers,maxProperties,userCount,propertyCount}`, `staffUsers` software-owner assignees `{id,name}`, `recoveryDrills` `{id,environment,evidence,passed,createdAt}`. No provider secrets.

POST `/api/experience/actions` uses `usePerformExperienceAction` mutation `{data:{action,payload}}`, returns `{result}`. Each payload is strictly validated:
- createThread: `{kind,title,body,attachments?:string[],diagnosticsConsent?:boolean,page?:string,clientVersion?:string}`. page is a PATH ONLY, never full URL/query.
- replyThread: `{threadId,body,attachments?:string[],internal?:boolean}`. Internal requires software owner. User can reply only to own threads.
- updateThread: `{threadId,status,priority,assigneeId?:number|null,duplicateOf?:string|null}`. Software owner only.
- saveContent: `{id?:string,kind:"help"|"release",title,body,published:boolean}`. Software owner only. Published releases notify staff.
- saveOnboarding: `{completedSteps:string[]}`. Company owner/manager only.
- saveCompanyPolicy: `{tenantId:number,subscriptionRequired:boolean,trialUntil:string|null,graceDays:number,enforceLimits:boolean}`. Software owner only, explicit opt-in, never deletes records or silently enables charges.
- recordRecoveryDrill: `{environment:"development"|"staging",evidence:string,passed:boolean}`. Software owner only; this is entered evidence, NOT an automatic claim that a restore occurred.
- runChecks: `{}`. Company owner/manager checks own company, software owner checks all.
- resolveAlert: `{id:string}`. Own company owner/manager or software owner only.

POST `/api/experience/uploads` accepts multipart `file` PNG/JPEG/WebP <=5MiB. Use shared `customFetch`, not raw fetch identity headers. Returns `{id,name}`; support-message attachments are these opaque IDs. GET `/api/experience/uploads/:id` authorized blob download; never use the generic public object URL.

GET `/api/experience/export` company-owner only returns downloadable JSON of that company's business records with credentials/security tokens excluded. Use authenticated customFetch blob.

GET `/api/account-security` useGetAccountSecurity returns `{enabled:boolean,recoveryCodesRemaining:number}`.
POST `/api/account-security` useUpdateAccountSecurity `{data:{action:"enroll"|"confirm"|"disable"|"recoveryCodes",password,code?}}`.
- enroll: returns `{secret,otpauthUrl}`, pending 10 minutes. Show authenticator setup instructions/manual secret, never localStorage or URLs/navigation containing secret.
- confirm: code required; returns `{enabled:true,recoveryCodes:string[]}` ONCE.
- disable/recoveryCodes: require password and current authenticator code OR unused recovery code; disable returns `{enabled:false}`, recoveryCodes returns new one-time list.
- Setup is optional and must not be enabled automatically.

Password login accepts optional `twoFactorCode`; correct password on MFA account returns 401 `{error,mfaRequired:true}` until a valid code is supplied. Recovery codes accepted. Preserve native phone unlock/remember-device behavior.

Public password reset:
- useRequestStaffPasswordReset `{data:{email}}` always returns generic `{message}`; never confirms email existence. Email delivery requires configured company provider; never logs token or uses development fake send.
- useConfirmStaffPasswordReset `{data:{token,password}}`, password minimum12. Returns `{success:true}`. Current sessions revoked, MFA stays enabled.
- Public web `/reset-password?token=...`; strip token from URL immediately into ephemeral state; do not send diagnostics/referrers with it.

Existing customer service feedback is already implemented through `/reviews` and `/public/reviews/:token`. Extend it rather than create another survey system: keep Reviews nav/settings, low-rating alert, issue acknowledgement, photos on public review and staff review detail. Feedback about customer service belongs to that business, never the software support inbox. Existing automatic request rules remain opt-in.
