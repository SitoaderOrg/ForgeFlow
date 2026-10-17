import { GAME_STATES } from './constants.js';
import { Ferret } from './ferret.js';
import { Human } from './human.js';
import { Vacuum } from './vacuum.js';
import { Stash } from './stash.js';
import { generateLootList } from './loot.js';

export class GameEngine {
  constructor(options = {}) {
    this.state = GAME_STATES.MENU;
    this.ferret = new Ferret(120, 500);
    this.human = new Human();
    this.vacuum = new Vacuum();
    this.lootList = generateLootList();
    this.stash = new Stash(5);
    this.message =
      'Sneak around, steal shiny things, and stash them under the couch!';
    this.messageTimer = 300;
    this.level = 1;
    this.caughtCount = 0;

    // Event callbacks for audio/visual juice
    this.onEvent = options.onEvent || (() => {});
  }

  start() {
    this.state = GAME_STATES.PLAYING;
    this.setMessage('Heist in progress! Grab socks & keys!');
    this.onEvent('start');
  }

  restart() {
    this.ferret = new Ferret(120, 500);
    this.human = new Human();
    this.vacuum = new Vacuum();
    this.lootList = generateLootList();
    this.stash = new Stash(5);
    this.state = GAME_STATES.PLAYING;
    this.caughtCount = 0;
    this.setMessage('Fresh heist started! Be stealthy!');
    this.onEvent('restart');
  }

  pause() {
    if (this.state === GAME_STATES.PLAYING) {
      this.state = GAME_STATES.PAUSED;
    } else if (this.state === GAME_STATES.PAUSED) {
      this.state = GAME_STATES.PLAYING;
    }
  }

  setMessage(text, duration = 180) {
    this.message = text;
    this.messageTimer = duration;
  }

  tick(input = {}, dt = 1) {
    if (this.state !== GAME_STATES.PLAYING) {
      return;
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) {
        this.message = '';
      }
    }

    const wasDancing = this.ferret.isDancing;
    this.ferret.update(input, dt);

    if (!wasDancing && this.ferret.isDancing) {
      this.onEvent('wardance');
      this.setMessage('WEASEL WAR DANCE! CHAOS ENGAGED! 🐾🌀');
    }

    // 1. Loot pickup
    if (this.ferret.canPickUp()) {
      for (const loot of this.lootList) {
        if (loot.isNearby(this.ferret.x, this.ferret.y, 26)) {
          this.ferret.pickUp(loot);
          this.onEvent('pickup', loot);
          this.setMessage(`Swiped ${loot.name}! Take it to the couch!`);
          break;
        }
      }
    }

    // 2. Couch Deposit
    if (
      this.ferret.carriedItem &&
      this.stash.isUnderCouch(this.ferret.x, this.ferret.y)
    ) {
      const item = this.ferret.carriedItem;
      this.ferret.dropItem();
      const points = this.stash.deposit(item);
      this.onEvent('deposit', { item, points });
      this.setMessage(`Stashed ${item.name}! +${points} pts! 🧦✨`);

      if (this.stash.isCleared()) {
        this.state = GAME_STATES.LEVEL_CLEARED;
        this.setMessage(
          'HEIST COMPLETE! The hoard under the couch is glorious! 🏆'
        );
        this.onEvent('victory');
        return;
      }
    }

    // 3. Vacuum interaction
    this.vacuum.update(dt);
    if (!this.vacuum.isStunned && this.vacuum.collidesWith(this.ferret, 18)) {
      if (this.ferret.isDancing) {
        this.vacuum.stun(240);
        this.onEvent('stun_vacuum');
        this.setMessage('Roomba was baffled by the Weasel War Dance! 🌀🤖');
      } else {
        const dropped = this.ferret.dropItem();
        this.onEvent('bump');
        this.human.alert();
        this.setMessage(
          dropped
            ? `BUMPED BY VACUUM! Dropped ${dropped.name}!`
            : 'Squeak! Bumped by the vacuum!'
        );
      }
    }

    // 4. Human alert & spotting
    const spotted = this.human.update(this.ferret, dt);
    if (spotted && !this.ferret.isHiding) {
      this.caughtCount++;
      const dropped = this.ferret.dropItem();
      this.onEvent('caught');

      // Ferret dashes back under the couch
      this.ferret.x = 120;
      this.ferret.y = 500;
      this.human.stateTimer = 0;

      if (this.caughtCount >= 3) {
        this.state = GAME_STATES.CAUGHT;
        this.setMessage(
          'CAUGHT 3 TIMES! The human put everything in a locked drawer! 😿'
        );
        this.onEvent('gameover');
      } else {
        this.setMessage(
          `SPOTTED! ${dropped ? `Lost ${dropped.name}! ` : ''}Dashed under the couch! (${3 - this.caughtCount} strikes left)`
        );
      }
    }
  }
}
