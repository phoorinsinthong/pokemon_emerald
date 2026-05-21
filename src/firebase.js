import { initializeApp } from "firebase/app";
import { getDatabase, ref as dbRef, set, get, onValue, remove, update } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ─── Base64 helpers ───
function uint8ToBase64(uint8) {
  let binary = '';
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Cloud Save helpers (Realtime DB, free) ───
export async function uploadSaveToCloud(userId, saveData) {
  const data = saveData instanceof Uint8Array ? saveData : new Uint8Array(saveData);
  const b64 = uint8ToBase64(data);
  await set(dbRef(db, `saves/${userId}`), {
    data: b64,
    size: data.length,
    updatedAt: Date.now(),
  });
  console.log("[Cloud Save] Uploaded to RTDB successfully");
}

export async function downloadSaveFromCloud(userId) {
  const snapshot = await get(dbRef(db, `saves/${userId}`));
  if (!snapshot.exists()) return null;
  const val = snapshot.val();
  console.log("[Cloud Save] Downloaded from RTDB successfully");
  return base64ToUint8(val.data);
}

// ─── Room helpers ───
export async function createRoom(roomId, playerName) {
  const roomRef = dbRef(db, `rooms/${roomId}`);
  await set(roomRef, {
    createdAt: Date.now(),
    host: playerName,
    players: { [playerName]: { joinedAt: Date.now(), online: true } },
  });
}

export async function joinRoom(roomId, playerName) {
  const roomRef = dbRef(db, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) throw new Error("ไม่พบห้องนี้");
  const data = snapshot.val();
  const playerCount = data.players ? Object.keys(data.players).length : 0;
  if (playerCount >= 4) throw new Error("ห้องเต็มแล้ว (สูงสุด 4 คน)");
  await update(dbRef(db, `rooms/${roomId}/players/${playerName}`), {
    joinedAt: Date.now(),
    online: true,
  });
  return data;
}

export function onRoomUpdate(roomId, callback) {
  const roomRef = dbRef(db, `rooms/${roomId}`);
  return onValue(roomRef, (snapshot) => callback(snapshot.val()));
}

export async function leaveRoom(roomId, playerName) {
  await remove(dbRef(db, `rooms/${roomId}/players/${playerName}`));
  // check if room empty
  const snapshot = await get(dbRef(db, `rooms/${roomId}/players`));
  if (!snapshot.exists()) await remove(dbRef(db, `rooms/${roomId}`));
}

export async function sendChatMessage(roomId, playerName, message) {
  const msgRef = dbRef(db, `rooms/${roomId}/chat/${Date.now()}`);
  await set(msgRef, { player: playerName, text: message, time: Date.now() });
}

export function onChatUpdate(roomId, callback) {
  const chatRef = dbRef(db, `rooms/${roomId}/chat`);
  return onValue(chatRef, (snapshot) => {
    const data = snapshot.val();
    callback(data ? Object.values(data).slice(-50) : []);
  });
}

// ─── Player status ───
export async function updatePlayerStatus(roomId, playerName, status) {
  // status: 'lobby' | 'playing' | 'offline'
  await update(dbRef(db, `rooms/${roomId}/players/${playerName}`), {
    status,
    lastSeen: Date.now(),
  });
}

// ─── Auto-cleanup old rooms (24h) ───
export async function cleanupOldRooms() {
  const roomsRef = dbRef(db, 'rooms');
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return;
  const rooms = snapshot.val();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (const [id, room] of Object.entries(rooms)) {
    if (room.createdAt && now - room.createdAt > DAY) {
      await remove(dbRef(db, `rooms/${id}`));
      console.log(`[Cleanup] Removed old room: ${id}`);
    }
  }
}

// ─── Trade Board ───
export async function postTrade(roomId, playerName, offering, wanting) {
  const tradeId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  await set(dbRef(db, `rooms/${roomId}/trades/${tradeId}`), {
    id: tradeId,
    from: playerName,
    offering,
    wanting,
    status: 'open', // open | accepted | completed
    acceptedBy: null,
    createdAt: Date.now(),
  });
  return tradeId;
}

export async function acceptTrade(roomId, tradeId, playerName) {
  await update(dbRef(db, `rooms/${roomId}/trades/${tradeId}`), {
    status: 'accepted',
    acceptedBy: playerName,
  });
}

export async function completeTrade(roomId, tradeId) {
  await update(dbRef(db, `rooms/${roomId}/trades/${tradeId}`), {
    status: 'completed',
  });
}

export async function cancelTrade(roomId, tradeId) {
  await remove(dbRef(db, `rooms/${roomId}/trades/${tradeId}`));
}

export function onTradesUpdate(roomId, callback) {
  const tradesRef = dbRef(db, `rooms/${roomId}/trades`);
  return onValue(tradesRef, (snapshot) => {
    const data = snapshot.val();
    callback(data ? Object.values(data) : []);
  });
}

// ─── Save Sharing (between room members, via RTDB) ───
export async function shareSaveToRoom(roomId, playerName, saveData) {
  const data = saveData instanceof Uint8Array ? saveData : new Uint8Array(saveData);
  const b64 = uint8ToBase64(data);
  await set(dbRef(db, `room-saves/${roomId}/${playerName}`), {
    data: b64,
    size: data.length,
    sharedAt: Date.now(),
  });
  await update(dbRef(db, `rooms/${roomId}/players/${playerName}`), {
    sharedSave: true,
    sharedAt: Date.now(),
  });
}

export async function downloadSharedSave(roomId, playerName) {
  const snapshot = await get(dbRef(db, `room-saves/${roomId}/${playerName}`));
  if (!snapshot.exists()) return null;
  return base64ToUint8(snapshot.val().data);
}

export { app, db };
