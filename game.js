/* Premium Space Shooter — game.js
   - Canvas drawing only (no external images)
   - Touch controls + keyboard
   - Laser sound + explosion sound (WebAudio)
   - Particles for explosion
   - Score & Best (localStorage)
   - Ready for Cordova
*/

(() => {
  // DOM
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const infoScore = document.getElementById('score');
  const infoBest  = document.getElementById('best');
  const modal = document.getElementById('modal');
  const modalScore = document.getElementById('modal-score');
  const btnRestart = document.getElementById('btn-restart');
  const btnMenu = document.getElementById('btn-menu');

  // Controls
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnUp = document.getElementById('btn-up');
  const btnDown = document.getElementById('btn-down');
  const btnFire = document.getElementById('btn-fire');

  // canvas size (game internal resolution)
  const GAME_W = 900;
  const GAME_H = 1400;
  canvas.width = GAME_W;
  canvas.height = GAME_H;

  // scale to fit
  function fit() {
    const maxW = Math.min(window.innerWidth, 900);
    const scale = maxW / GAME_W;
    canvas.style.width = (GAME_W * scale) + 'px';
    canvas.style.height = (GAME_H * scale) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  // audio (WebAudio)
  let audioCtx = null;
  let audioAllowed = false;
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }
  function playSound(freq=440, dur=0.08, type='sine', vol=0.04) {
    if (!audioAllowed) return;
    ensureAudio();
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch(e){}
  }
  function playExplosionSound() {
    if (!audioAllowed) return;
    ensureAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 120;
    g.gain.value = 0.12;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    // quick decline
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    o.stop(audioCtx.currentTime + 0.5);
  }

  // resume audio on first gesture
  function allowAudioOnGesture() {
    if (audioAllowed) return;
    audioAllowed = true;
    ensureAudio();
    try { audioCtx.resume(); } catch(e){}
  }

  // game state
  let running = false;
  let score = 0;
  let best = parseInt(localStorage.getItem('vip_shooter_best') || '0');
  infoBest.innerText = `Best: ${best}`;
  infoScore.innerText = `Score: ${score}`;

  // player
  const player = {
    x: GAME_W/2,
    y: GAME_H - 160,
    w: 64,
    h: 64,
    speed: 420,
    cooldown: 0, // fire cooldown
    color: '#66f',
    alive: true
  };

  // bullets, enemies, particles
  const bullets = [];
  const enemies = [];
  const particles = [];

  // spawn control
  let enemyTimer = 0;
  let enemyInterval = 900; // ms
  let lastTime = 0;

  // input state
  const input = { left:false, right:false, up:false, down:false, fire:false };
  // keyboard
  window.addEventListener('keydown', e=>{
    if (e.code === 'ArrowLeft') input.left = true;
    if (e.code === 'ArrowRight') input.right = true;
    if (e.code === 'ArrowUp') input.up = true;
    if (e.code === 'ArrowDown') input.down = true;
    if (e.code === 'Space') input.fire = true;
    // allow audio on any key
    allowAudioOnGesture();
  });
  window.addEventListener('keyup', e=>{
    if (e.code === 'ArrowLeft') input.left = false;
    if (e.code === 'ArrowRight') input.right = false;
    if (e.code === 'ArrowUp') input.up = false;
    if (e.code === 'ArrowDown') input.down = false;
    if (e.code === 'Space') input.fire = false;
  });

  // touch buttons
  const touchBtnMap = [
    [btnLeft,'left'],
    [btnRight,'right'],
    [btnUp,'up'],
    [btnDown,'down'],
    [btnFire,'fire']
  ];
  touchBtnMap.forEach(([el, key])=>{
    let down = false;
    el.addEventListener('pointerdown', (e)=>{ e.preventDefault(); input[key]=true; down=true; allowAudioOnGesture(); });
    el.addEventListener('pointerup', (e)=>{ e.preventDefault(); input[key]=false; down=false; });
    el.addEventListener('pointercancel', ()=>{ input[key]=false; down=false; });
    el.addEventListener('pointerout', ()=>{ if(down) { input[key]=false; down=false; }});
  });

  // pointer drag on canvas to move ship (mobile)
  let dragging = false;
  canvas.addEventListener('pointerdown', (e)=>{
    dragging = true;
    allowAudioOnGesture();
    // pointer y above bottom -> fire if quick tap
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (GAME_W / rect.width);
    const sy = (e.clientY - rect.top) * (GAME_H / rect.height);
    // if top half, flap/fire else move
    if (sy < GAME_H * 0.75) {
      input.fire = true;
      setTimeout(()=>input.fire=false, 120);
    }
  });
  window.addEventListener('pointermove', (e)=>{
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (GAME_W / rect.width);
    const sy = (e.clientY - rect.top) * (GAME_H / rect.height);
    player.x = Math.max(40, Math.min(GAME_W-40, sx));
    player.y = Math.max(60, Math.min(GAME_H-220, sy));
  });
  window.addEventListener('pointerup', ()=>{ dragging=false; input.fire=false; });

  // helpers
  function rand(min,max){ return Math.random()*(max-min)+min; }
  function rectsCollide(ax,ay,aw,ah, bx,by,bw,bh){
    return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by;
  }

  // spawn enemy
  function spawnEnemy() {
    const size = rand(44,88);
    const x = rand(40, GAME_W - 40 - size);
    const y = -size - 20;
    const speed = rand(90, 220);
    enemies.push({ x,y,w:size,h:size,spd:speed, hp: 1 + Math.floor(rand(0,2)) });
  }

  // fire bullet
  function fireBullet() {
    if (player.cooldown > 0) return;
    player.cooldown = 220; // ms
    bullets.push({ x: player.x, y: player.y - 40, vx: 0, vy: -680, w:6, h:14, t:0 });
    playSound(1200, 0.06, 'triangle', 0.06);
  }

  // explosion particles
  function spawnExplosion(x,y,color,amount=18) {
    for (let i=0;i<amount;i++){
      const angle = Math.random()*Math.PI*2;
      const speed = rand(60, 340);
      particles.push({
        x,y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        life: rand(500,1200), t:0, color: color
      });
    }
    playExplosionSound();
  }

  // update loop
  function update(dt) {
    if (!running) return;
    // input movement
    const mv = player.speed * dt;
    if (input.left) player.x -= mv;
    if (input.right) player.x += mv;
    if (input.up) player.y -= mv;
    if (input.down) player.y += mv;
    player.x = Math.max(40, Math.min(GAME_W-40, player.x));
    player.y = Math.max(60, Math.min(GAME_H-220, player.y));

    // fire
    if (input.fire) fireBullet();
    if (btnFire && input.fire) { /* already handled */ }

    // cooldown
    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt*1000);

    // spawn enemies
    enemyTimer += dt*1000;
    if (enemyTimer > enemyInterval) {
      enemyTimer = 0;
      spawnEnemy();
      // speed up spawn slowly
      enemyInterval = Math.max(420, enemyInterval * 0.985);
    }

    // update bullets
    for (let i=bullets.length-1;i>=0;i--){
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.t += dt*1000;
      if (b.y < -20 || b.t > 5000) bullets.splice(i,1);
    }

    // update enemies
    for (let i=enemies.length-1;i>=0;i--){
      const e = enemies[i];
      e.y += e.spd * dt;
      // collision with bullets
      for (let j=bullets.length-1;j>=0;j--){
        const b = bullets[j];
        if (rectsCollide(b.x - b.w/2, b.y - b.h/2, b.w, b.h, e.x, e.y, e.w, e.h)){
          bullets.splice(j,1);
          e.hp--;
          spawnExplosion(b.x, b.y, '#ffd166', 6);
          playSound(1800,0.04,'sine',0.04);
          if (e.hp <= 0){
            spawnExplosion(e.x + e.w/2, e.y + e.h/2, '#ff6b6b', 28);
            enemies.splice(i,1);
            score += 10;
            infoScore.innerText = `Score: ${score}`;
          }
          break;
        }
      }
      // collision with player
      if (rectsCollide(player.x - player.w/2, player.y - player.h/2, player.w, player.h, e.x, e.y, e.w, e.h)){
        // explode player
        spawnExplosion(player.x, player.y, '#ff6b6b', 36);
        gameOver();
        return;
      }
      // remove offscreen
      if (e.y > GAME_H + 120) {
        enemies.splice(i,1);
      }
    }

    // update particles
    for (let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.t += dt*1000;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt; // gravity small
      if (p.t > p.life) particles.splice(i,1);
    }
  }

  // draw
  function draw() {
    // clear with space background gradient + stars
    ctx.clearRect(0,0,GAME_W,GAME_H);
    const g = ctx.createLinearGradient(0,0,0,GAME_H);
    g.addColorStop(0,'#001121');
    g.addColorStop(1,'#071226');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,GAME_W,GAME_H);

    // starfield
    drawStars(ctx);

    // draw player (ship)
    ctx.save();
    ctx.translate(player.x, player.y);
    // ship body
    ctx.fillStyle = '#66ccff';
    roundedRect(ctx, -player.w/2, -player.h/2, player.w, player.h, 8);
    ctx.fill();
    // cockpit
    ctx.fillStyle = '#062a3a';
    ctx.fillRect(-12, -10, 24, 14);
    // thruster flame if moving/fire
    if (player.cooldown < 200) {
      ctx.fillStyle = 'rgba(255,140,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(0, player.h/2 + 6, 12, 6, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    // bullets
    bullets.forEach(b=>{
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(b.x - b.w/2, b.y - b.h/2, b.w, b.h);
    });

    // enemies
    enemies.forEach(e=>{
      // hull
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(e.x, e.y, e.w, e.h);
      // cockpit
      ctx.fillStyle = '#2b0b0b';
      ctx.fillRect(e.x + e.w*0.2, e.y + e.h*0.15, e.w*0.6, e.h*0.2);
      // engine glow
      ctx.fillStyle = 'rgba(255,140,0,0.3)';
      ctx.fillRect(e.x + e.w*0.35, e.y + e.h - 8, e.w*0.3, 6);
    });

    // particles
    particles.forEach(p=>{
      const t = 1 - (p.t / p.life);
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
      ctx.globalAlpha = 1;
    });

    // HUD (canvas-high)
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(12,12,220,42);
    ctx.fillStyle = '#fff';
    ctx.font = '20px Inter, Arial';
    ctx.fillText(`Score: ${score}`, 22, 38);
    ctx.fillStyle = '#dfeeff';
    ctx.fillText(`Best: ${best}`, 150, 38);
  }

  // simple starfield (keeps same stars)
  const starField = Array.from({length:120}, () => ({ x: rand(0,GAME_W), y: rand(0,GAME_H), s: rand(0.8,2.6), tw: rand(600,2000) , off: rand(0,2000) }));
  function drawStars(ctx){
    const t = Date.now();
    ctx.fillStyle = '#fff';
    starField.forEach(s=>{
      const alpha = 0.25 + 0.75 * Math.abs(Math.sin((t + s.off) / s.tw));
      ctx.globalAlpha = alpha;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    });
    ctx.globalAlpha = 1;
  }

  // helpers: rounded rect
  function roundedRect(ctx,x,y,w,h,r){
    const radius = r;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // main ticker
  let rafId = null;
  function tick(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min(40, now - lastTime) / 1000;
    lastTime = now;
    update(dt);
    draw();
    rafId = requestAnimationFrame(tick);
  }

  // start/stop
  function start() {
    running = true;
    score = 0;
    infoScore.innerText = `Score: ${score}`;
    enemies.length = 0; bullets.length = 0; particles.length = 0;
    lastTime = 0; enemyTimer = 0; enemyInterval = 900; player.x = GAME_W/2; player.y = GAME_H - 160; player.cooldown = 0;
    modal.classList.add('hidden');
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // game over
  function gameOver() {
    stop();
    running = false;
    if (score > best) { best = score; localStorage.setItem('vip_shooter_best', ''+best); infoBest.innerText = `Best: ${best}`; }
    modalScore.innerText = `Score: ${score}`;
    modal.classList.remove('hidden');
  }

  // restart button
  btnRestart.addEventListener('click', ()=> {
    modal.classList.add('hidden');
    start();
  });
  btnMenu.addEventListener('click', ()=> {
    modal.classList.add('hidden');
    stop(); // stays stopped; you can add a menu later
  });

  // auto-fire handling (player.cooldown handled)
  setInterval(()=>{
    // reduce cooldown if any (ms tick)
    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - 50);
  }, 50);

  // initial small instruction prompt: on first touch/press enable audio and start
  function introPrompt() {
    // basic overlay drawn via modal to start game
    modal.classList.remove('hidden');
    modalScore.innerText = 'Tap Restart to Start (or use keyboard Space/Arrows)';
    btnRestart.innerText = 'Start Game';
    // on first start allow audio
    btnRestart.onclick = ()=>{ allowAudioOnGesture(); start(); btnRestart.innerText = 'Restart'; };
  }
  introPrompt();

  // utility random
  function rand(min,max){ return Math.random()*(max-min)+min; }

})();
