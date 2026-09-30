import { GameEngine } from './game/engine.js';
import { GameRenderer } from './game/render.js';
import { SoundEffects } from './game/audio.js';
import { GAME_STATES } from './game/constants.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const sfx = new SoundEffects();

  const engine = new GameEngine({
    onEvent: (event, payload) => {
      switch (event) {
        case 'pickup':
          sfx.pickup();
          break;
        case 'deposit':
          sfx.deposit();
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
