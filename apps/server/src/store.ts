import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export class Store<T extends {id:string}> {
  private db:DatabaseSync;
  constructor(path:string){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, player_id TEXT NOT NULL);');
  }
  rooms():T[]{return this.db.prepare('SELECT data FROM rooms').all().map(row=>JSON.parse(String(row.data)) as T);}
  tokens():[string,string][]{return this.db.prepare('SELECT hash, player_id FROM tokens').all().map(row=>[String(row.hash),String(row.player_id)]);}
  putRoom(room:T){this.db.prepare('INSERT INTO rooms(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(room.id,JSON.stringify(room));}
  deleteRoom(id:string){this.db.prepare('DELETE FROM rooms WHERE id=?').run(id);}
  putToken(hash:string,playerId:string){this.db.prepare('INSERT INTO tokens(hash,player_id) VALUES(?,?) ON CONFLICT(hash) DO UPDATE SET player_id=excluded.player_id').run(hash,playerId);}
  close(){this.db.close();}
}
