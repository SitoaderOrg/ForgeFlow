import { GameEngine } from './game/engine.js';
import { GameRenderer } from './game/render.js';
import { SoundEffects } from './game/audio.js';
import { GAME_STATES } from './game/constants.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas');
  const sfx = new SoundEffects();

  // Personalised heist banner, e.g. index.html?player=Bandit
  const params = new URLSearchParams(window.location.search);
  const playerName = params.get('player') || 'Sneaky Ferret';
  const banner = document.getElementById('player-banner');
  let engine;
  const updateBanner = () => {
    if (!banner || !engine) return;
    const s = engine.streak.getSummary();
    banner.innerHTML = `🐾 <strong>${playerName}</strong> — ${s.rank} · streak x${s.streak} (best ${s.bestStreak}) · +${s.bonusPoints} bonus pts`;
  };

  engine = new GameEngine({
    onEvent: (event) => {
      switch (event) {
        case 'pickup':
          sfx.pickup();
          break;
        case 'deposit':
          sfx.deposit();
          updateBanner();
          break;
        case 'wardance':
          sfx.wardance();
          break;
        case 'bump':
          sfx.bump();
          break;
        case 'stun_vacuum':
          sfx.stunVacuum();
          break;
        case 'caught':
          sfx.caught();
          updateBanner();
          break;
        case 'start':
        case 'restart':
          updateBanner();
          break;
        case 'victory':
          sfx.victory();
          break;
        default:
          break;
      }
    }
  });

  const renderer = new GameRenderer(canvas);
  const keys = {};

  // Keyboard handlers
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;

    if (engine.state === GAME_STATES.MENU) {
      engine.start();
    } else if (
      engine.state === GAME_STATES.LEVEL_CLEARED ||
      engine.state === GAME_STATES.CAUGHT
    ) {
      engine.restart();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // Canvas click to start/restart
  canvas.addEventListener('click', () => {
    sfx.init();
    if (engine.state === GAME_STATES.MENU) {
      engine.start();
    } else if (
      engine.state === GAME_STATES.LEVEL_CLEARED ||
      engine.state === GAME_STATES.CAUGHT
    ) {
      engine.restart();
    }
  });

  // On-screen control buttons for touch or mouse testing
  const bindButton = (id, keyCode) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const startPress = (e) => {
      e.preventDefault();
      keys[keyCode] = true;
      if (engine.state === GAME_STATES.MENU) engine.start();
    };
    const endPress = (e) => {
      e.preventDefault();
      keys[keyCode] = false;
    };
    btn.addEventListener('mousedown', startPress);
    btn.addEventListener('mouseup', endPress);
    btn.addEventListener('mouseleave', endPress);
    btn.addEventListener('touchstart', startPress, { passive: false });
    btn.addEventListener('touchend', endPress, { passive: false });
  };

  bindButton('btn-up', 'ArrowUp');
  bindButton('btn-down', 'ArrowDown');
  bindButton('btn-left', 'ArrowLeft');
  bindButton('btn-right', 'ArrowRight');
  bindButton('btn-dance', 'Space');

  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      sfx.init();
      engine.restart();
    });
  }

  // Main game loop
  let lastTime = performance.now();
  function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 16.666, 2.0);
    lastTime = now;

    engine.tick(keys, dt);
    renderer.render(engine);

    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);
});
