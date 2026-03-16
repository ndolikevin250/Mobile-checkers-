class SoundManager {
    constructor() {
        this.audioContext = null;
        this.enabled = false;
        this.userInteracted = false;
        this.initAudio();
    }

    async initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // Don't enable by default - wait for user interaction
            this.enabled = false;
        } catch (e) {
            console.log('Web Audio API not supported');
            this.enabled = false;
        }
    }

    async enableAudio() {
        if (!this.audioContext) return false;

        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (e) {
                console.log('Failed to resume AudioContext:', e);
                return false;
            }
        }

        this.enabled = true;
        this.userInteracted = true;
        return true;
    }

    async playTone(frequency, duration, type = 'sine', volume = 0.1) {
        // Only play if audio context is running and user has interacted
        if (!this.audioContext || !this.enabled || !this.userInteracted || this.audioContext.state !== 'running') {
            return;
        }

        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            oscillator.type = type;

            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration);
        } catch (e) {
            console.log('Audio playback failed:', e.message);
        }
    }

    async playMove() {
        await this.playTone(523, 0.15, 'sine', 0.08); // C5
    }

    async playCapture() {
        await this.playTone(440, 0.2, 'square', 0.1); // A4
        setTimeout(async () => await this.playTone(330, 0.15, 'square', 0.08), 50); // E4
    }

    async playKing() {
        await this.playTone(659, 0.1, 'triangle', 0.08); // E5
        setTimeout(async () => await this.playTone(784, 0.1, 'triangle', 0.08), 50); // G5
        setTimeout(async () => await this.playTone(988, 0.2, 'triangle', 0.08), 100); // B5
    }

    async playVictory() {
        const notes = [523, 587, 659, 698, 784]; // C5, D5, E5, F5, G5
        for (let i = 0; i < notes.length; i++) {
            setTimeout(async () => await this.playTone(notes[i], 0.3, 'sine', 0.1), i * 100);
        }
    }

    async playDefeat() {
        const notes = [392, 370, 349, 330, 311]; // G4, F#4, F4, E4, Eb4 (descending)
        for (let i = 0; i < notes.length; i++) {
            setTimeout(async () => await this.playTone(notes[i], 0.4, 'sawtooth', 0.08), i * 80);
        }
    }

    async playInvalid() {
        await this.playTone(200, 0.2, 'sawtooth', 0.05);
    }

    async playGameStart() {
        await this.playTone(440, 0.1, 'sine', 0.06);
        setTimeout(async () => await this.playTone(554, 0.1, 'sine', 0.06), 50);
        setTimeout(async () => await this.playTone(659, 0.15, 'sine', 0.06), 100);
    }
}
