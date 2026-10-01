import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  COUCH,
  CHAIR,
  RUG,
  HIDING_BOXES,
  HUMAN_STATES,
  GAME_STATES
} from './constants.js';

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(engine) {
    const { ctx } = this;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. Draw hardwood floor
    this.drawFloor(ctx);

    // 2. Draw Rug
    this.drawRug(ctx);

    // 3. Draw Couch & Stash Zone
    this.drawCouch(ctx, engine.stash);

    // 4. Draw Hiding Boxes / Tunnels
    this.drawBoxes(ctx);

    // 5. Draw Human & Chair
    this.drawHumanAndChair(ctx, engine.human);

    // 6. Draw Vacuum
    this.drawVacuum(ctx, engine.vacuum);

    // 7. Draw Loot items on floor
    this.drawLoot(ctx, engine.lootList);

    // 7b. Draw Power-Up snacks
    if (engine.powerUpManager) {
      this.drawPowerUps(ctx, engine.powerUpManager.activePowerUps);
    }

    // 8. Draw Ferret
    this.drawFerret(ctx, engine.ferret);

    // 9. Draw HUD
    this.drawHUD(ctx, engine);

    // 10. Draw Screen Overlays for Menu, Victory, Caught
    this.drawOverlays(ctx, engine);
  }

  drawFloor(ctx) {
    ctx.fillStyle = '#c89f72';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Wood floor planks lines
    ctx.strokeStyle = '#b58b5e';
    ctx.lineWidth = 1.5;
    for (let y = 0; y < CANVAS_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }
  }

  drawRug(ctx) {
    ctx.fillStyle = '#688c7a';
    ctx.fillRect(RUG.x, RUG.y, RUG.width, RUG.height);

    ctx.strokeStyle = '#4e6d5e';
    ctx.lineWidth = 3;
    ctx.strokeRect(RUG.x + 4, RUG.y + 4, RUG.width - 8, RUG.height - 8);

    // Pattern in center
    ctx.fillStyle = '#7a9f8d';
    ctx.beginPath();
    ctx.ellipse(
      RUG.x + RUG.width / 2,
      RUG.y + RUG.height / 2,
      RUG.width / 3,
      RUG.height / 3,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  drawCouch(ctx, stash) {
    // Under-couch stash opening (dark shadow)
    ctx.fillStyle = '#1f1610';
    ctx.fillRect(COUCH.x - 10, COUCH.y - 10, COUCH.width + 20, COUCH.height + 20);

    // Couch back and arms
    ctx.fillStyle = '#824936';
    ctx.fillRect(COUCH.x, COUCH.y, COUCH.width, COUCH.height);

    // Cushions
    ctx.fillStyle = '#9e5a44';
    ctx.fillRect(COUCH.x + 10, COUCH.y + 10, COUCH.width / 2 - 15, COUCH.height - 20);
    ctx.fillRect(
      COUCH.x + COUCH.width / 2 + 5,
      COUCH.y + 10,
      COUCH.width / 2 - 15,
      COUCH.height - 20
    );

    // Stash banner
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('COUCH STASH (DROP ZONE)', COUCH.x + 20, COUCH.y + 35);

    // Stashed items emoji icons under couch
    const stashed = stash.stashedItems;
    stashed.forEach((item, idx) => {
      ctx.font = '16px sans-serif';
      ctx.fillText(item.emoji, COUCH.x + 20 + (idx % 6) * 28, COUCH.y + 70 + Math.floor(idx / 6) * 24);
    });
  }

  drawBoxes(ctx) {
    for (const box of HIDING_BOXES) {
      ctx.fillStyle = '#c79c5e';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = '#8d6834';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Tunnel flaps
      ctx.fillStyle = '#2c1e11';
      ctx.beginPath();
      ctx.arc(box.x + box.width / 2, box.y + box.height / 2, 20, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.fillText('TUNNEL', box.x + 20, box.y + 18);
    }
  }

  drawHumanAndChair(ctx, human) {
    // Armchair
    ctx.fillStyle = '#3f51b5';
    ctx.fillRect(CHAIR.x, CHAIR.y, CHAIR.width, CHAIR.height);
    ctx.fillStyle = '#303f9f';
    ctx.fillRect(CHAIR.x + 15, CHAIR.y + 15, CHAIR.width - 30, CHAIR.height - 30);

    // Sleeping Human head
    ctx.fillStyle = '#ffcc80';
    ctx.beginPath();
    ctx.arc(human.x, human.y, 22, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = '#4e342e';
    ctx.beginPath();
    ctx.arc(human.x, human.y - 6, 22, Math.PI, 0);
    ctx.fill();

    // Human vision cone
    const { distance, fov } = human.getVisionConfig();
    const coneGrad = ctx.createRadialGradient(
      human.x,
      human.y,
      10,
      human.x,
      human.y,
      distance
    );

    if (human.state === HUMAN_STATES.AWAKE) {
      coneGrad.addColorStop(0, 'rgba(255, 69, 58, 0.45)');
      coneGrad.addColorStop(1, 'rgba(255, 69, 58, 0.05)');
    } else if (human.state === HUMAN_STATES.SUSPICIOUS) {
      coneGrad.addColorStop(0, 'rgba(255, 214, 10, 0.35)');
      coneGrad.addColorStop(1, 'rgba(255, 214, 10, 0.05)');
    } else {
      coneGrad.addColorStop(0, 'rgba(100, 210, 255, 0.15)');
      coneGrad.addColorStop(1, 'rgba(100, 210, 255, 0.0)');
    }

    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(human.x, human.y);
    ctx.arc(
      human.x,
      human.y,
      distance,
      human.angle - fov / 2,
      human.angle + fov / 2
    );
    ctx.closePath();
    ctx.fill();

    // Alert or Snore bubble
    ctx.font = 'bold 22px sans-serif';
    if (human.state === HUMAN_STATES.SLEEPING) {
      ctx.fillStyle = '#3b82f6';
      const snoreY = human.y - 30 + Math.sin(human.snoreTimer) * 4;
      ctx.fillText('Zzz...', human.x - 20, snoreY);
    } else if (human.state === HUMAN_STATES.SUSPICIOUS) {
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('❓', human.x - 10, human.y - 30);
    } else if (human.state === HUMAN_STATES.AWAKE) {
      ctx.fillStyle = '#ef4444';
      ctx.fillText('❗👀', human.x - 18, human.y - 32);
    }
  }

  drawPowerUps(ctx, powerUps = []) {
    for (const p of powerUps) {
      if (p.isCollected) continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, p.x, p.y);
      ctx.restore();
    }
  }

  drawVacuum(ctx, vacuum) {
    ctx.save();
    ctx.translate(vacuum.x, vacuum.y);

    // Body
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(0, 0, vacuum.radius, 0, Math.PI * 2);
    ctx.fill();

    // Bumper ring
    ctx.strokeStyle = '#455a64';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Power light
    ctx.fillStyle = vacuum.isStunned ? '#ffb300' : '#00e676';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    if (vacuum.isStunned) {
      ctx.font = '16px sans-serif';
      ctx.fillText('💫', -8, -12);
    }

    ctx.restore();
  }

  drawLoot(ctx, lootList) {
    for (const loot of lootList) {
      if (loot.isCarried || loot.isStashed) continue;

      ctx.save();
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(loot.x, loot.y + 10, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Emoji
      ctx.font = '22px sans-serif';
      ctx.fillText(loot.emoji, loot.x - 12, loot.y + 6);
      ctx.restore();
    }
  }

  drawFerret(ctx, ferret) {
    if (ferret.isHiding) {
      // Small sneak indicator
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '12px sans-serif';
      ctx.fillText('(Hidden 🕵️)', ferret.x - 24, ferret.y - 20);
    }

    // Draw noodle body segments from history
    const history = ferret.history;
    const bodyColors = ['#f5e6d3', '#cbb094', '#997455', '#6e4f35'];

    ctx.lineCap = 'round';
    for (let i = history.length - 1; i >= 0; i -= 2) {
      const seg = history[i];
      const ratio = 1 - i / history.length;
      const segRadius = ferret.size * (0.6 + ratio * 0.4);

      ctx.fillStyle = bodyColors[Math.min(bodyColors.length - 1, Math.floor((1 - ratio) * 4))];
      ctx.beginPath();
      ctx.arc(seg.x, seg.y, segRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Ferret Head
    ctx.save();
    ctx.translate(ferret.x, ferret.y);
    ctx.rotate(ferret.angle);

    // Head base (cream/tan)
    ctx.fillStyle = '#f5e6d3';
    ctx.beginPath();
    ctx.ellipse(0, 0, ferret.size * 1.1, ferret.size * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mask markings (dark raccoon-like mask)
    ctx.fillStyle = '#5c4033';
    ctx.beginPath();
    ctx.ellipse(3, -5, 6, 4, 0.2, 0, Math.PI * 2);
    ctx.ellipse(3, 5, 6, 4, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(4, -5, 2.5, 0, Math.PI * 2);
    ctx.arc(4, 5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Eye glint
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(5, -6, 1, 0, Math.PI * 2);
    ctx.arc(5, 4, 1, 0, Math.PI * 2);
    ctx.fill();

    // Pink nose
    ctx.fillStyle = '#ff9999';
    ctx.beginPath();
    ctx.arc(ferret.size * 1.05, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Cute ferret ears
    ctx.fillStyle = '#cbb094';
    ctx.beginPath();
    ctx.arc(-8, -10, 4.5, 0, Math.PI * 2);
    ctx.arc(-8, 10, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // If carrying loot, draw in mouth!
    if (ferret.carriedItem) {
      ctx.font = '18px sans-serif';
      ctx.fillText(ferret.carriedItem.emoji, ferret.size * 1.1, 6);
    }

    ctx.restore();

    // War Dance sparkle chaos
    if (ferret.isDancing) {
      ctx.font = '14px sans-serif';
      ctx.fillText('✨DOOK!✨', ferret.x - 20, ferret.y - 25);
    }
  }

  drawHUD(ctx, engine) {
    // Top banner
    ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, 48);

    // Score
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`🏆 Score: ${engine.stash.totalScore}`, 20, 30);

    // Stashed progress
    ctx.fillStyle = '#81c784';
    ctx.fillText(
      `🧦 Stashed: ${engine.stash.stashedItems.length}/${engine.stash.targetCount}`,
      180,
      30
    );

    // War Dance meter bar
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText('🐾 War Dance [SPACE]:', 350, 29);

    ctx.fillStyle = '#444';
    ctx.fillRect(495, 17, 100, 14);

    const dancePercent = engine.ferret.danceMeter / 100;
    ctx.fillStyle = engine.ferret.isDancing ? '#ff4081' : '#f59e0b';
    ctx.fillRect(495, 17, 100 * dancePercent, 14);

    // Caught strikes
    ctx.fillStyle = '#ef5350';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`🚨 Strikes: ${engine.caughtCount}/3`, 630, 30);

    // Bottom Message bar
    if (engine.message) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(CANVAS_WIDTH / 2 - 250, CANVAS_HEIGHT - 38, 500, 30);
      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(engine.message, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 18);
      ctx.textAlign = 'left';
    }
  }

  drawOverlays(ctx, engine) {
    if (engine.state === GAME_STATES.MENU) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb74d';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('🐾 FERRET HEIST: STASH UNDER THE COUCH 🐾', CANVAS_WIDTH / 2, 220);

      ctx.fillStyle = '#ffffff';
      ctx.font = '18px sans-serif';
      ctx.fillText('You are Bandit, a noodle of pure mischief!', CANVAS_WIDTH / 2, 270);
      ctx.fillText('Sneak around the living room and swipe 5 shiny items.', CANVAS_WIDTH / 2, 300);
      ctx.fillText('Drag them under the couch before the sleeping human catches you!', CANVAS_WIDTH / 2, 330);

      ctx.fillStyle = '#81c784';
      ctx.font = '16px sans-serif';
      ctx.fillText('🎮 Controls: Arrow Keys or WASD to move | SPACE for Weasel War Dance', CANVAS_WIDTH / 2, 380);

      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('👉 CLICK OR PRESS ANY KEY TO START 👈', CANVAS_WIDTH / 2, 450);
      ctx.textAlign = 'left';
    } else if (engine.state === GAME_STATES.LEVEL_CLEARED) {
      ctx.fillStyle = 'rgba(20, 50, 20, 0.85)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#69f0ae';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillText('🎉 HEIST MASTER FERRET! 🎉', CANVAS_WIDTH / 2, 230);

      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      ctx.fillText(`Final Score: ${engine.stash.totalScore} points`, CANVAS_WIDTH / 2, 280);
      ctx.fillText('The couch stash is packed with stolen treasures!', CANVAS_WIDTH / 2, 320);

      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('👉 CLICK TO PLAY AGAIN 👈', CANVAS_WIDTH / 2, 400);
      ctx.textAlign = 'left';
    } else if (engine.state === GAME_STATES.CAUGHT) {
      ctx.fillStyle = 'rgba(60, 20, 20, 0.85)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5252';
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('😿 BUSTED BY THE HUMAN! 😿', CANVAS_WIDTH / 2, 230);

      ctx.fillStyle = '#ffffff';
      ctx.font = '18px sans-serif';
      ctx.fillText('3 strikes! All socks and shiny keys have been locked away.', CANVAS_WIDTH / 2, 280);

      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('👉 CLICK TO TRY AGAIN 👈', CANVAS_WIDTH / 2, 380);
      ctx.textAlign = 'left';
    }
  }
}
