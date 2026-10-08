export const GEMINI_MODEL='gemini-3.5-flash-lite';
export function answerSettings(config={},overrides={}){
  const provider=overrides.provider||config.answerProvider||'gemini';
  if(!['gemini','luna'].includes(provider))throw Error('Answer provider must be gemini or luna.');
  const prefix=provider==='gemini'?'gemini-':'gpt-';
  const matches=typeof config.answerModel==='string'&&config.answerModel.startsWith(prefix)&&(!config.answerProvider||config.answerProvider===provider);
  const model=overrides.model||(matches?config.answerModel:null)||(provider==='gemini'?GEMINI_MODEL:'gpt-6-luna');
  if(!model.startsWith(prefix)||!/^[a-z0-9.-]+$/.test(model))throw Error('Answer model does not match the selected provider.');
  const effort=overrides.effort||(matches?config.answerEffort:null)||(provider==='gemini'?'minimal':'low');
  const allowed=provider==='gemini'?['minimal','low','medium','high']:['low','medium','high','xhigh','max','ultra'];
  if(!allowed.includes(effort))throw Error('Unsupported answer effort for the selected provider.');
  return {provider,model,effort};
}
