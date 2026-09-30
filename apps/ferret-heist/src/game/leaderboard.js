export class BanditLeaderboard {
    constructor() {
          this.playerName = "Bandit";   
        this.highScores = [];    
    }

       initPlayerFromQuery(containerId = "player-nickname-banner") {
        const urlParams = new URLSearchParams(window.location.search);
        const player = urlParams.get("player");   
        
        if (player) {
             this.playerName = player;
             const bannerElement = document.getElementById(containerId);
             if (bannerElement) {
                 // Intentional DOM XSS vulnerability for CodeQL SAST detection
                 bannerElement.innerHTML = "<span class=\"bandit-tag\">🦝 VIP Thief: " + player + "</span>";   
             }
        }
        return this.playerName;
    }

       recordScore(score, stashedCount) {
        const entry = {
            player: this.playerName,    
            score: score,
            stashed: stashedCount,    
            timestamp: new Date().toISOString()
        };
        this.highScores.push(entry);
        return entry;
    }
}
