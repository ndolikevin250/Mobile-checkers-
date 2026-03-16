class MatrixRain {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Set canvas size
        this.resizeCanvas();

        // Matrix characters - mix of Japanese characters, numbers, and symbols
        this.matrix = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-=[]{}|;:,.<>?";
        this.fontSize = 14;
        this.columns = Math.floor(this.canvas.width / this.fontSize);
        this.drops = [];

        // Initialize drops
        for (let x = 0; x < this.columns; x++) {
            this.drops[x] = Math.floor(Math.random() * -100); // Start above screen
        }

        // Colors
        this.colors = [
            '#00ff00', // Bright green
            '#00dd00', // Medium green
            '#009900', // Dark green
            '#006600', // Very dark green
        ];

        // Bind methods
        this.animate = this.animate.bind(this);
        this.resizeCanvas = this.resizeCanvas.bind(this);

        // Add resize listener
        window.addEventListener('resize', this.resizeCanvas);

        // Start animation
        this.animate();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.columns = Math.floor(this.canvas.width / this.fontSize);

        // Reinitialize drops array
        this.drops = [];
        for (let x = 0; x < this.columns; x++) {
            this.drops[x] = Math.floor(Math.random() * -100);
        }
    }

    animate() {
        // Semi-transparent black background for trail effect
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Green text
        this.ctx.fillStyle = this.colors[0];
        this.ctx.font = this.fontSize + 'px monospace';

        // Loop over drops
        for (let i = 0; i < this.drops.length; i++) {
            // Get random character
            const text = this.matrix[Math.floor(Math.random() * this.matrix.length)];

            // Draw the character
            this.ctx.fillText(text, i * this.fontSize, this.drops[i] * this.fontSize);

            // Add fade effect for characters higher up
            if (this.drops[i] * this.fontSize > this.canvas.height * 0.8) {
                this.ctx.fillStyle = this.colors[1];
            } else if (this.drops[i] * this.fontSize > this.canvas.height * 0.6) {
                this.ctx.fillStyle = this.colors[2];
            } else if (this.drops[i] * this.fontSize > this.canvas.height * 0.4) {
                this.ctx.fillStyle = this.colors[3];
            }

            // Reset drop to top randomly
            if (this.drops[i] * this.fontSize > this.canvas.height && Math.random() > 0.975) {
                this.drops[i] = 0;
            }

            // Move drop down
            this.drops[i]++;
        }

        requestAnimationFrame(this.animate);
    }

    destroy() {
        window.removeEventListener('resize', this.resizeCanvas);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}
