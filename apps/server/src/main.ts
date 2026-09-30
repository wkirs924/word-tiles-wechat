import {startServer} from './server.ts';
const service=await startServer();
console.log(`word-tiles server listening on 127.0.0.1:${service.port} (${process.env.LOCAL_MODE==='1'?'LOCAL':'PRODUCTION'})`);
