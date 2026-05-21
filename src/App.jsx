import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, ShieldAlert, X, Copy, Check, Gamepad2, Users, Plus, LogIn, MessageCircle, Send, Cloud, Download, Upload, Share2, Zap, ArrowLeftRight, Package, Trash2, Bell, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { uploadSaveToCloud, downloadSaveFromCloud, createRoom, joinRoom, onRoomUpdate, leaveRoom, sendChatMessage, onChatUpdate, updatePlayerStatus, cleanupOldRooms, postTrade, acceptTrade, cancelTrade, onTradesUpdate, shareSaveToRoom, downloadSharedSave } from './firebase';

const CHEATS = [
  { name: "Master Ball (PC Item 1)", code: "82025840 0001", type: "CodeBreaker" },
  { name: "Rare Candy (PC Item 2)", code: "82025844 0044", type: "CodeBreaker" },
  { name: "Walk Through Walls", code: "7881A409 E2026E0C\n8E883EFF 92E9660D", type: "GameShark" },
  { name: "Shiny Pokemon Encounter", code: "F3A9A86D 4E2629B4\n18452A7D DDE55BCC", type: "GameShark" }
];

function getPlayerId() {
  let id = localStorage.getItem('poke-player-id');
  if (!id) { id = 'player-' + Math.random().toString(36).substr(2, 8); localStorage.setItem('poke-player-id', id); }
  return id;
}

function getPlayerName() {
  return localStorage.getItem('poke-player-name') || '';
}

function App() {
  const [screen, setScreen] = useState('home');
  const [playerName, setPlayerName] = useState(getPlayerName());
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCheats, setShowCheats] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(-1);
  const [saveStatus, setSaveStatus] = useState('');
  const [cloudStatus, setCloudStatus] = useState('idle');
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  // Room state
  const [roomId, setRoomId] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [roomError, setRoomError] = useState('');
  const [roomMode, setRoomMode] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  // Trade state
  const [trades, setTrades] = useState([]);
  const [tradeOffering, setTradeOffering] = useState('');
  const [tradeWanting, setTradeWanting] = useState('');
  const [roomTab, setRoomTab] = useState('chat'); // chat | trade | share
  const [shareLoading, setShareLoading] = useState(false);

  // PWA Install
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [notifPermission, setNotifPermission] = useState(Notification?.permission || 'default');

  const gameRef = useRef(null);
  const playerId = useRef(getPlayerId());
  const unsubRoom = useRef(null);
  const unsubChat = useRef(null);
  const unsubTrades = useRef(null);
  const prevPlayerCount = useRef(0);
  const prevTradeCount = useRef(0);

  // ─── PWA Install Prompt ───
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      // Show banner if not already installed and not dismissed
      if (!localStorage.getItem('pwa-install-dismissed')) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setShowInstallBanner(false);
      setInstallPrompt(null);
    }
  };

  const dismissInstall = () => {
    setShowInstallBanner(false);
    localStorage.setItem('pwa-install-dismissed', '1');
  };

  // ─── Notifications ───
  const requestNotifPermission = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  };

  const sendNotification = (title, body) => {
    if (notifPermission !== 'granted') return;
    try {
      new Notification(title, {
        body,
        icon: import.meta.env.BASE_URL + 'favicon.svg',
        badge: import.meta.env.BASE_URL + 'favicon.svg',
      });
    } catch (e) { /* mobile may not support */ }
  };

  // Notify on room changes (new player joins, new trade)
  useEffect(() => {
    if (!roomData?.players) return;
    const currentCount = Object.keys(roomData.players).length;
    if (prevPlayerCount.current > 0 && currentCount > prevPlayerCount.current) {
      const newPlayers = Object.keys(roomData.players);
      const newest = newPlayers[newPlayers.length - 1];
      if (newest !== playerName) {
        sendNotification('🎮 เพื่อนเข้าห้องแล้ว!', `${newest} เข้าร่วมห้อง ${roomId}`);
      }
    }
    prevPlayerCount.current = currentCount;
  }, [roomData?.players]);

  useEffect(() => {
    const openTrades = trades.filter(t => t.status === 'open');
    if (prevTradeCount.current > 0 && openTrades.length > prevTradeCount.current) {
      const newest = openTrades[openTrades.length - 1];
      if (newest.from !== playerName) {
        sendNotification('🔄 ข้อเสนอแลกใหม่!', `${newest.from} เสนอ: ${newest.offering} ↔ ${newest.wanting}`);
      }
    }
    prevTradeCount.current = openTrades.length;
  }, [trades]);

  // ─── Auto-join from URL ───
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get('room');
    if (joinId) {
      setRoomId(joinId.toUpperCase());
      setRoomMode('join');
    }
    cleanupOldRooms().catch(() => {});
  }, []);

  // ─── Landscape Lock ───
  useEffect(() => {
    if (isPlaying && screen === 'playing') {
      try {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) { /* not supported */ }
    }
    return () => {
      try {
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
        }
      } catch (e) { /* not supported */ }
    };
  }, [isPlaying, screen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubRoom.current) unsubRoom.current();
      if (unsubChat.current) unsubChat.current();
      if (unsubTrades.current) unsubTrades.current();
    };
  }, []);

  // ─── Cloud Save ───
  const cloudSave = useCallback(async () => {
    try {
      setCloudStatus('saving');
      const saveData = await getSRAMFromDB();
      if (!saveData) { setSaveStatus('ไม่พบข้อมูล save — ลอง save ในเกมก่อน'); setCloudStatus('error'); return; }
      await uploadSaveToCloud(playerId.current, saveData);
      setSaveStatus('☁️ Save ขึ้น Cloud สำเร็จ!');
      setCloudStatus('done');
      setTimeout(() => { setSaveStatus(''); setCloudStatus('idle'); }, 3000);
    } catch (e) {
      setSaveStatus('❌ Save ล้มเหลว: ' + e.message);
      setCloudStatus('error');
    }
  }, []);

  const cloudLoad = useCallback(async () => {
    try {
      setCloudStatus('loading');
      const data = await downloadSaveFromCloud(playerId.current);
      if (!data) { setSaveStatus('ไม่พบ save บน Cloud'); setCloudStatus('error'); setTimeout(() => { setSaveStatus(''); setCloudStatus('idle'); }, 3000); return; }
      // Save to our local DB
      await putSRAMToDB(data);
      // Try to inject into running emulator
      try { loadSRAMIntoEmulator(data); } catch(e) {}
      setSaveStatus('☁️ โหลด Cloud Save สำเร็จ! กด Reset ในเมนูเพื่อใช้งาน');
      setCloudStatus('done');
      setTimeout(() => { setSaveStatus(''); setCloudStatus('idle'); }, 5000);
    } catch (e) {
      setSaveStatus('❌ โหลดล้มเหลว: ' + e.message);
      setCloudStatus('error');
    }
  }, []);

  // ─── Speed Control ───
  const cycleSpeed = useCallback(() => {
    const speeds = [1, 2, 4];
    const next = speeds[(speeds.indexOf(speedMultiplier) + 1) % speeds.length];
    setSpeedMultiplier(next);
    try {
      if (window.EJS_emulator) {
        window.EJS_emulator.setFastForwardRatio(next);
        if (next > 1) window.EJS_emulator.setFastForward(true);
        else window.EJS_emulator.setFastForward(false);
      }
    } catch (e) { console.log('Speed API not available'); }
    setSaveStatus(`⚡ Speed: ${next}x`);
    setTimeout(() => setSaveStatus(''), 1500);
  }, [speedMultiplier]);

  // ═══════════════════════════════════════════
  // SAVE SYSTEM — Auto Save State
  // Periodically captures full emulator state
  // and restores it on next visit
  // ═══════════════════════════════════════════
  const DB_NAME = 'PokeSaveDB';
  const STORE_NAME = 'states';
  const SAVE_KEY = 'emerald-autostate';

  function openSaveDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putStateToDB(data) {
    const db = await openSaveDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, SAVE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getStateFromDB() {
    const db = await openSaveDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(SAVE_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  // Extract save state from emulator
  function extractState() {
    try {
      const emu = window.EJS_emulator;
      if (!emu) return null;
      // Try gameManager.getState()
      if (emu.gameManager) {
        if (typeof emu.gameManager.getState === 'function') {
          const s = emu.gameManager.getState();
          if (s && s.length > 0) return new Uint8Array(s);
        }
        if (typeof emu.gameManager.getSaveFile === 'function') {
          const s = emu.gameManager.getSaveFile();
          if (s && s.length > 0) return new Uint8Array(s);
        }
      }
      return null;
    } catch(e) { return null; }
  }

  // Load save state into emulator
  function loadState(data) {
    try {
      const emu = window.EJS_emulator;
      if (!emu || !data) return false;
      if (emu.gameManager) {
        if (typeof emu.gameManager.setState === 'function') {
          emu.gameManager.setState(new Uint8Array(data));
          return true;
        }
        if (typeof emu.gameManager.loadSaveFile === 'function') {
          emu.gameManager.loadSaveFile(new Uint8Array(data));
          return true;
        }
      }
      return false;
    } catch(e) { return false; }
  }

  // Save state to DB (used by auto-save and manual triggers)
  async function autoSave() {
    const state = extractState();
    if (state && state.length > 0) {
      await putStateToDB(state);
      console.log('[AutoSave] Saved:', state.length, 'bytes');
      return true;
    }
    return false;
  }

  // Aliases for cloud/share
  async function extractSaveFromIndexedDB() { return getStateFromDB(); }
  async function injectSaveToIndexedDB(data) { return putStateToDB(data); }

  // ─── Emulator Setup ───
  useEffect(() => {
    if (isPlaying) {
      window.EJS_player = '#game';
      window.EJS_core = 'gba';
      window.EJS_gameName = 'Pokemon Emerald';
      window.EJS_color = '#0fcb8e';
      window.EJS_startOnLoaded = true;
      window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
      window.EJS_gameUrl = import.meta.env.BASE_URL + 'emerald.gba';
      window.EJS_cheats = CHEATS.map(c => [c.name, c.code.replace(/\n/g, '+')]);
      window.EJS_gameID = 'pokemon-emerald';
      window.EJS_defaultOptions = { 'save-state-location': 'browser' };

      let autoSaveInterval = null;

      // Manual save state button callback
      window.EJS_onSaveState = function(e) {
        if (e && e.state) {
          putStateToDB(new Uint8Array(e.state)).catch(() => {});
        } else {
          autoSave().catch(() => {});
        }
        setSaveStatus('💾 Save State บันทึกแล้ว');
        setTimeout(() => setSaveStatus(''), 2000);
      };

      window.EJS_onGameStart = async function() {
        setSaveStatus('🎮 กำลังโหลด save...');
        if (roomId) updatePlayerStatus(roomId, playerName, 'playing').catch(() => {});

        // Wait for emulator to fully initialize
        await new Promise(r => setTimeout(r, 2000));

        // Auto-load previous state
        try {
          const savedState = await getStateFromDB();
          if (savedState && savedState.length > 0) {
            const loaded = loadState(savedState);
            if (loaded) {
              setSaveStatus('✅ โหลด save สำเร็จ!');
            } else {
              setSaveStatus('🎮 เกมเริ่มแล้ว (ไม่สามารถโหลด save ได้)');
            }
          } else {
            setSaveStatus('🎮 เกมเริ่มแล้ว');
          }
        } catch(e) {
          setSaveStatus('🎮 เกมเริ่มแล้ว');
        }
        setTimeout(() => setSaveStatus(''), 3000);

        // Auto-save state every 30 seconds
        autoSaveInterval = setInterval(() => {
          autoSave().then(ok => {
            if (ok) {
              setSaveStatus('💾 Auto-saved');
              setTimeout(() => setSaveStatus(''), 1000);
            }
          }).catch(() => {});
        }, 30000);
      };

      // Save when tab becomes hidden (more reliable than beforeunload on mobile)
      const visibilityHandler = () => {
        if (document.visibilityState === 'hidden') {
          autoSave().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);

      // Also save on beforeunload as backup
      const beforeUnloadHandler = () => {
        autoSave().catch(() => {});
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);

      // Load EmulatorJS
      const script = document.createElement('script');
      script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
      script.async = true;
      script.id = 'ejs-loader-script';
      document.body.appendChild(script);

      try {
        if (window.screen?.orientation?.lock) {
          window.screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) {}

      return () => {
        autoSave().catch(() => {});
        if (autoSaveInterval) clearInterval(autoSaveInterval);
        document.removeEventListener('visibilitychange', visibilityHandler);
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        const s = document.getElementById('ejs-loader-script');
        if (s) s.remove();
        try { window.screen?.orientation?.unlock?.(); } catch(e) {}
      };
    }
  }, [isPlaying, roomId, playerName]);

  // ─── Share helpers ───
  const getShareUrl = () => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${roomId}`;
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(getShareUrl());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const nativeShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'เข้าร่วมห้อง Pokemon Emerald!', text: `เข้าห้อง ${roomId} มาเล่นกัน!`, url: getShareUrl() });
    } else {
      copyShareLink();
    }
  };

  // ─── Room Functions ───
  const handleCreateRoom = async () => {
    if (!playerName.trim()) { setRoomError('กรุณาใส่ชื่อผู้เล่น'); return; }
    const newRoomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    try {
      localStorage.setItem('poke-player-name', playerName);
      await createRoom(newRoomId, playerName);
      setRoomId(newRoomId);
      setRoomError('');
      unsubRoom.current = onRoomUpdate(newRoomId, setRoomData);
      unsubChat.current = onChatUpdate(newRoomId, setChatMessages);
      unsubTrades.current = onTradesUpdate(newRoomId, setTrades);
      setScreen('room');
    } catch (e) { setRoomError(e.message); }
  };

  const handleJoinRoom = async () => {
    if (!playerName.trim()) { setRoomError('กรุณาใส่ชื่อผู้เล่น'); return; }
    if (!roomId.trim()) { setRoomError('กรุณาใส่รหัสห้อง'); return; }
    try {
      localStorage.setItem('poke-player-name', playerName);
      await joinRoom(roomId.toUpperCase(), playerName);
      setRoomId(roomId.toUpperCase());
      setRoomError('');
      unsubRoom.current = onRoomUpdate(roomId.toUpperCase(), setRoomData);
      unsubChat.current = onChatUpdate(roomId.toUpperCase(), setChatMessages);
      unsubTrades.current = onTradesUpdate(roomId.toUpperCase(), setTrades);
      setScreen('room');
    } catch (e) { setRoomError(e.message); }
  };

  const handleLeaveRoom = async () => {
    if (unsubRoom.current) unsubRoom.current();
    if (unsubChat.current) unsubChat.current();
    if (unsubTrades.current) unsubTrades.current();
    await leaveRoom(roomId, playerName).catch(() => {});
    setRoomData(null); setRoomId(''); setTrades([]); setScreen('home');
    window.history.replaceState({}, '', window.location.pathname);
  };

  // ─── Trade Functions ───
  const handlePostTrade = async (e) => {
    e.preventDefault();
    if (!tradeOffering.trim() || !tradeWanting.trim()) return;
    await postTrade(roomId, playerName, tradeOffering.trim(), tradeWanting.trim());
    setTradeOffering(''); setTradeWanting('');
  };

  const handleAcceptTrade = async (tradeId) => {
    await acceptTrade(roomId, tradeId, playerName);
  };

  const handleCancelTrade = async (tradeId) => {
    await cancelTrade(roomId, tradeId);
  };

  const handleShareSave = async () => {
    try {
      setShareLoading(true);
      const saveData = await extractSaveFromIndexedDB();
      if (!saveData) { setSaveStatus('ไม่พบ save data'); setShareLoading(false); return; }
      await shareSaveToRoom(roomId, playerName, saveData);
      setSaveStatus('📤 แชร์ Save ให้ห้องแล้ว!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      setSaveStatus('❌ ' + e.message);
    } finally { setShareLoading(false); }
  };

  const handleDownloadSharedSave = async (fromPlayer) => {
    try {
      setShareLoading(true);
      const data = await downloadSharedSave(roomId, fromPlayer);
      if (!data) { setSaveStatus(`ไม่พบ save ของ ${fromPlayer}`); setShareLoading(false); return; }
      await injectSaveToIndexedDB(data);
      setSaveStatus(`📥 โหลด save ของ ${fromPlayer} แล้ว!`);
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) {
      setSaveStatus('❌ ' + e.message);
    } finally { setShareLoading(false); }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    await sendChatMessage(roomId, playerName, chatInput);
    setChatInput('');
  };

  const startGameFromRoom = () => {
    if (roomId && playerName) updatePlayerStatus(roomId, playerName, 'playing').catch(() => {});
    setIsPlaying(true);
    setScreen('playing');
  };

  const startSoloGame = () => {
    if (!playerName.trim()) { setRoomError('กรุณาใส่ชื่อก่อน'); return; }
    localStorage.setItem('poke-player-name', playerName);
    setIsPlaying(true);
    setScreen('playing');
  };

  const copyCheat = (code, index) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(-1), 2000);
  };

  const statusIcon = (status) => {
    if (status === 'playing') return '🟢';
    if (status === 'lobby') return '🟡';
    return '⚪';
  };

  // ═══════════════════════════════════════════
  // PLAYING SCREEN
  // ═══════════════════════════════════════════
  if (screen === 'playing') {
    return (
      <div className="app-container">
        <div className="floating-buttons">
          <button className="floating-btn" onClick={() => setShowCheats(!showCheats)} title="Cheats">
            <ShieldAlert size={20} />
          </button>
          <button className="floating-btn" onClick={cloudSave} disabled={cloudStatus === 'saving'} title="Upload Save">
            <Upload size={20} />
          </button>
          <button className="floating-btn" onClick={cloudLoad} disabled={cloudStatus === 'loading'} title="Download Save">
            <Download size={20} />
          </button>
          <button className={`floating-btn ${speedMultiplier > 1 ? 'speed-active' : ''}`} onClick={cycleSpeed} title="Speed">
            <Zap size={20} />
            {speedMultiplier > 1 && <span className="speed-label">{speedMultiplier}x</span>}
          </button>
          {roomData && (
            <button className="floating-btn" onClick={() => setShowChat(!showChat)} title="Chat">
              <MessageCircle size={20} />
            </button>
          )}
        </div>

        {saveStatus && <div className="save-toast">{saveStatus}</div>}

        <div id="game-container">
          <div id="game" ref={gameRef} style={{ width: '100%', height: '100%', maxWidth: '100%' }}></div>
        </div>

        {showCheats && (
          <div className="cheat-overlay">
            <div className="cheat-menu glass">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className="title-font" style={{ fontSize: '0.9rem', margin: 0 }}>Cheat Codes</h3>
                <X size={24} style={{ cursor: 'pointer' }} onClick={() => setShowCheats(false)} />
              </div>
              <p style={{ fontSize: '0.8rem', marginBottom: '1rem', color: '#ccc' }}>
                เปิด/ปิด Cheat ได้ที่ Menu {'>'} Cheats ในตัว Emulator
              </p>
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {CHEATS.map((cheat, index) => (
                  <div key={index} className="cheat-item" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '0.4rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>{cheat.name}</span>
                      <span className="cheat-badge">{cheat.type}</span>
                    </div>
                    <div style={{ display: 'flex', width: '100%', gap: '8px' }}>
                      <pre className="cheat-code">{cheat.code}</pre>
                      <button className="copy-btn" onClick={() => copyCheat(cheat.code, index)}>
                        {copiedIndex === index ? <Check size={16} color="var(--primary)" /> : <Copy size={16} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {showChat && roomData && (
          <div className="chat-overlay">
            <div className="chat-panel glass">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>💬 ห้อง {roomId}</span>
                <X size={18} style={{ cursor: 'pointer' }} onClick={() => setShowChat(false)} />
              </div>
              <div className="chat-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-msg ${msg.player === playerName ? 'mine' : ''}`}>
                    <strong>{msg.player}: </strong>{msg.text}
                  </div>
                ))}
              </div>
              <form onSubmit={handleSendChat} className="chat-input-row">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="พิมพ์ข้อความ..." className="chat-input" />
                <button type="submit" className="send-btn"><Send size={16} /></button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // ROOM LOBBY
  // ═══════════════════════════════════════════
  if (screen === 'room' && roomData) {
    const players = roomData.players ? Object.entries(roomData.players) : [];
    return (
      <div className="app-container">
        <div className="room-screen glass">
          <div className="room-header">
            <Users size={28} color="var(--primary)" />
            <h2 className="title-font" style={{ fontSize: '1rem', margin: 0 }}>ห้อง: {roomId}</h2>
          </div>

          {/* Share Section */}
          <div className="share-section">
            <div className="room-code-display">
              <span>รหัสห้อง</span>
              <strong>{roomId}</strong>
              <button className="copy-btn small" onClick={copyShareLink}>
                {linkCopied ? <Check size={14} color="var(--primary)" /> : <Copy size={14} />}
              </button>
              <button className="copy-btn small" onClick={nativeShare}>
                <Share2 size={14} />
              </button>
            </div>
            <button className="btn btn-ghost qr-toggle" onClick={() => setShowShare(!showShare)}>
              {showShare ? 'ซ่อน QR' : '📱 แสดง QR Code'}
            </button>
            {showShare && (
              <div className="qr-container">
                <QRCodeSVG value={getShareUrl()} size={140} bgColor="transparent" fgColor="#0fcb8e" level="M" />
                <span className="qr-hint">เพื่อนสแกนเพื่อเข้าห้อง</span>
              </div>
            )}
          </div>

          {/* Player List */}
          <div className="player-list">
            <span className="player-count">{players.length}/8 ผู้เล่น</span>
            {players.map(([name, info], i) => (
              <div key={i} className="player-card">
                <div className="player-avatar">{name[0].toUpperCase()}</div>
                <span className="player-name">{name}</span>
                <span className="status-dot">{statusIcon(info.status)}</span>
                {name === roomData.host && <span className="host-badge">HOST</span>}
                {name === playerName && <span className="you-badge">คุณ</span>}
              </div>
            ))}
          </div>

          {saveStatus && <div className="save-toast lobby-toast">{saveStatus}</div>}

          {/* Tabs */}
          <div className="room-tabs">
            <button className={`tab-btn ${roomTab === 'chat' ? 'active' : ''}`} onClick={() => setRoomTab('chat')}>
              <MessageCircle size={14} /> แชท
            </button>
            <button className={`tab-btn ${roomTab === 'trade' ? 'active' : ''}`} onClick={() => setRoomTab('trade')}>
              <ArrowLeftRight size={14} /> แลกของ {trades.filter(t => t.status === 'open').length > 0 && <span className="tab-badge">{trades.filter(t => t.status === 'open').length}</span>}
            </button>
            <button className={`tab-btn ${roomTab === 'share' ? 'active' : ''}`} onClick={() => setRoomTab('share')}>
              <Package size={14} /> แชร์ Save
            </button>
          </div>

          {/* Tab Content */}
          {roomTab === 'chat' && (
            <div className="chat-section">
              <div className="chat-messages small">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-msg ${msg.player === playerName ? 'mine' : ''}`}>
                    <strong>{msg.player}: </strong>{msg.text}
                  </div>
                ))}
              </div>
              <form onSubmit={handleSendChat} className="chat-input-row">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="พิมพ์ข้อความ..." className="chat-input" />
                <button type="submit" className="send-btn"><Send size={16} /></button>
              </form>
            </div>
          )}

          {roomTab === 'trade' && (
            <div className="trade-section">
              <form onSubmit={handlePostTrade} className="trade-form">
                <div className="trade-inputs">
                  <input value={tradeOffering} onChange={e => setTradeOffering(e.target.value)} placeholder="มี... (เช่น Rayquaza Lv70)" className="chat-input" maxLength={30} />
                  <span className="trade-arrow">⇄</span>
                  <input value={tradeWanting} onChange={e => setTradeWanting(e.target.value)} placeholder="ต้องการ... (เช่น Kyogre)" className="chat-input" maxLength={30} />
                </div>
                <button type="submit" className="send-btn trade-post-btn" disabled={!tradeOffering || !tradeWanting}>
                  <Plus size={16} /> โพสต์
                </button>
              </form>
              <div className="trade-list">
                {trades.filter(t => t.status !== 'completed').length === 0 && (
                  <p className="empty-text">ยังไม่มีข้อเสนอแลก</p>
                )}
                {trades.filter(t => t.status !== 'completed').map((trade, i) => (
                  <div key={i} className={`trade-card ${trade.status}`}>
                    <div className="trade-header">
                      <span className="trade-from">{trade.from}</span>
                      {trade.status === 'accepted' && <span className="trade-status accepted">✅ {trade.acceptedBy} รับแล้ว</span>}
                      {trade.status === 'open' && <span className="trade-status open">เปิดรับ</span>}
                    </div>
                    <div className="trade-content">
                      <span className="trade-offer">🎁 {trade.offering}</span>
                      <span className="trade-arrow-small">→</span>
                      <span className="trade-want">✨ {trade.wanting}</span>
                    </div>
                    <div className="trade-actions">
                      {trade.status === 'open' && trade.from !== playerName && (
                        <button className="trade-accept-btn" onClick={() => handleAcceptTrade(trade.id)}>รับข้อเสนอ</button>
                      )}
                      {trade.from === playerName && (
                        <button className="trade-cancel-btn" onClick={() => handleCancelTrade(trade.id)}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {roomTab === 'share' && (
            <div className="share-save-section">
              <button className="btn btn-secondary" onClick={handleShareSave} disabled={shareLoading}>
                <Upload size={16} /> {shareLoading ? 'กำลังแชร์...' : 'แชร์ Save ของฉัน'}
              </button>
              <p className="share-hint">ดาวน์โหลด save ของเพื่อนในห้อง:</p>
              {players.filter(([name]) => name !== playerName).map(([name, info]) => (
                <button key={name} className="save-download-btn" onClick={() => handleDownloadSharedSave(name)} disabled={shareLoading || !info.sharedSave}>
                  <Download size={14} /> {name} {info.sharedSave ? '💾' : '(ยังไม่แชร์)'}
                </button>
              ))}
            </div>
          )}

          <div className="room-actions">
            <button className="btn btn-primary" onClick={startGameFromRoom}>
              <Play size={20} /> เริ่มเกม
            </button>
            <button className="btn btn-danger" onClick={handleLeaveRoom}>ออกจากห้อง</button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // HOME SCREEN
  // ═══════════════════════════════════════════
  return (
    <div className="app-container">
      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div className="install-banner glass">
          <Smartphone size={20} color="var(--primary)" />
          <div className="install-text">
            <strong>ติดตั้งลงหน้าจอ</strong>
            <span>เล่นได้เหมือนแอปจริง!</span>
          </div>
          <button className="install-btn" onClick={handleInstall}>ติดตั้ง</button>
          <X size={16} className="install-close" onClick={dismissInstall} />
        </div>
      )}

      <div className="welcome-screen glass">
        <Gamepad2 size={44} color="var(--primary)" style={{ marginBottom: '0.5rem' }} />
        <h1 className="title-font">Emerald<br/>PWA</h1>
        <p style={{ marginBottom: '1.2rem', color: '#ccc', fontSize: '0.85rem' }}>
          เล่น Pokemon Emerald ออนไลน์กับเพื่อน พร้อม Cloud Save
        </p>

        <div className="input-group">
          <label>ชื่อผู้เล่น</label>
          <input value={playerName} onChange={e => setPlayerName(e.target.value)} placeholder="ใส่ชื่อของคุณ..." className="text-input" maxLength={12} />
        </div>

        <div className="info-row">
          <div style={{ textAlign: 'left' }}>
            <span style={{ display: 'block', fontWeight: 'bold', color: 'var(--primary)', fontSize: '0.85rem' }}>ROM Loaded</span>
            <span style={{ fontSize: '0.75rem', color: '#aaa' }}>emerald.gba (USA)</span>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Cloud size={18} color="var(--primary)" />
              <span style={{ fontSize: '0.6rem', color: 'var(--primary)' }}>Cloud</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Zap size={18} color="var(--primary)" />
              <span style={{ fontSize: '0.6rem', color: 'var(--primary)' }}>Speed</span>
            </div>
          </div>
        </div>

        {/* Notification Permission */}
        {notifPermission === 'default' && (
          <button className="btn btn-notif" onClick={requestNotifPermission}>
            <Bell size={16} /> เปิดแจ้งเตือน (เพื่อนเข้าห้อง/แลกของ)
          </button>
        )}

        {roomError && <div className="error-msg">{roomError}</div>}

        {!roomMode ? (
          <div className="mode-buttons">
            <button className="btn btn-primary" onClick={startSoloGame}><Play size={18} /> เล่นคนเดียว</button>
            <button className="btn btn-secondary" onClick={() => setRoomMode('create')}><Plus size={18} /> สร้างห้อง (2-8 คน)</button>
            <button className="btn btn-secondary" onClick={() => setRoomMode('join')}><LogIn size={18} /> เข้าห้อง</button>
          </div>
        ) : roomMode === 'create' ? (
          <div className="mode-buttons">
            <p style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: '0.3rem' }}>สร้างห้องใหม่ แล้วแชร์ QR / ลิงก์ให้เพื่อน</p>
            <button className="btn btn-primary" onClick={handleCreateRoom}><Plus size={18} /> สร้างห้องเลย</button>
            <button className="btn btn-ghost" onClick={() => { setRoomMode(''); setRoomError(''); }}>← กลับ</button>
          </div>
        ) : (
          <div className="mode-buttons">
            <div className="input-group">
              <label>รหัสห้อง</label>
              <input value={roomId} onChange={e => setRoomId(e.target.value.toUpperCase())} placeholder="เช่น ABC123" className="text-input room-code-input" maxLength={6} />
            </div>
            <button className="btn btn-primary" onClick={handleJoinRoom}><LogIn size={18} /> เข้าห้อง</button>
            <button className="btn btn-ghost" onClick={() => { setRoomMode(''); setRoomError(''); setRoomId(''); }}>← กลับ</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
