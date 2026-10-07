// Synthetic Handler isolation only. Matches the libfaketime PostgreSQL clock.
// Never imported by a production entry point.
const NativeDate=Date,at=NativeDate.parse('2026-09-07T02:00:00Z');
globalThis.Date=class extends NativeDate {
 constructor(...args){super(...(args.length?args:[at]));}
 static now(){return at;}
};
