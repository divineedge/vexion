import {describe,it,expect} from 'vitest';
import {defaultWebsiteFlow,websiteFlowSchema,validateWebsiteAnswers,validateMeasurements} from './websiteFlow';
import {visibleFlow} from '@workspace/api-client-react/website-flow';
describe('published website flow invariants',()=>{
 it('validates defaults and rejects cyclic/dangling conditions and duplicate IDs',()=>{
  expect(websiteFlowSchema.safeParse(defaultWebsiteFlow('quote')).success).toBe(true);
  expect(websiteFlowSchema.safeParse(defaultWebsiteFlow('hiring')).success).toBe(true);
  const flow=defaultWebsiteFlow('hiring');
  flow.steps[0].questions[0].condition={field:'email',operator:'answered',value:''};
  expect(websiteFlowSchema.safeParse(flow).success).toBe(false);
  flow.steps[0].questions[0].condition=null;
  flow.steps[0].questions.push({...flow.steps[0].questions[0]});
  expect(websiteFlowSchema.safeParse(flow).success).toBe(false);
 });
 it('enforces visible required questions and drops hidden or injected answers',()=>{
  const flow=defaultWebsiteFlow('hiring');flow.steps[0].questions.push({id:'extra',label:'Follow-up',type:'text',required:true,options:[],condition:{field:'phone',operator:'answered',value:''}});
  const answers={name:'Applicant',email:'applicant@example.invalid',extra:{hidden:'not stored'},unauthorized:'never stored'};
  expect(validateWebsiteAnswers(flow,answers).answers).toEqual({name:answers.name,email:answers.email});
  expect(()=>validateWebsiteAnswers(flow,{...answers,extra:'',phone:'3035550123'})).toThrow('Follow-up is required');
  flow.steps[0].questions.at(-1)!.condition={field:'phone',operator:'not_equals',value:'yes'};
  expect(visibleFlow(flow,answers).steps[0].questions.some(q=>q.id==='extra')).toBe(false);
 });
 it('recomputes drawn area, ignores client manual values when points exist, and ignores hidden measurements',()=>{
  const flow=defaultWebsiteFlow('quote');
  const result=validateMeasurements(flow,{}, {measure:{mode:'area',manual:999999,points:[{lat:40,lng:-105},{lat:40.0001,lng:-105},{lat:40.0001,lng:-104.9999}]}});
  expect(result.areaSqft).toBeGreaterThan(100);expect(result.areaSqft).toBeLessThan(1000);
  flow.steps.at(-1)!.condition={field:'email',operator:'equals',value:'show'};
  expect(validateMeasurements(flow,{}, {measure:{mode:'area',manual:500,points:[]}}).areaSqft).toBeNull();
 });
 it('allows skipped optional measurements, blocks invalid or missing required values and pins',()=>{
  const flow=defaultWebsiteFlow('quote');expect(validateMeasurements(flow,{},{}).areaSqft).toBeNull();
  flow.steps.at(-1)!.required=true;
  expect(()=>validateMeasurements(flow,{},{})).toThrow('required');
  expect(()=>validateMeasurements(flow,{}, {measure:{mode:'area',points:[],manual:-1}})).toThrow('positive');
  flow.steps[2].required=true;
  const answers={name:'Customer',email:'customer@example.invalid',serviceIds:['1'],address:'1 Main',city:'Denver',state:'CO',zip:'80000'};
  expect(()=>validateWebsiteAnswers(flow,answers)).toThrow('Confirm');
  expect(()=>validateWebsiteAnswers(flow,{...answers,pinConfirmed:true,lat:100,lng:0})).toThrow('pin');
 });
});
