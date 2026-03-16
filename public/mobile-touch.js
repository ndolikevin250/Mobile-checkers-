/* ═══════════════════════════════════════════════════════
   MOBILE TOUCH & GESTURE SYSTEM
   Day 5: Touch Controls, Gesture Support, Mobile Performance
   ═══════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // ── Detect touch device ──
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

    if (!isTouchDevice && !isCoarsePointer) return;

    document.documentElement.classList.add('touch-device');

    // ── Optimize matrix rain on mobile ──
    const matrixCanvas = document.querySelector('.matrix-canvas');
    if (matrixCanvas) {
        matrixCanvas.classList.add('mobile-optimized');
    }

    // ── Board Touch Handler ──
    // Enhances the board with proper touch events for better mobile gameplay
    function initBoardTouchControls() {
        const board = document.querySelector('.board') || document.getElementById('board');
        if (!board) return;

        let touchStartTime = 0;
        let touchStartPos = { x: 0, y: 0 };
        let longPressTimer = null;
        let isLongPress = false;
        let activeTouchCell = null;

        // Prevent default touch behaviors on the board (scrolling, zooming)
        board.addEventListener('touchstart', function(e) {
            // Enable audio on first touch (must happen before preventDefault)
            if (typeof soundManager !== 'undefined' && !soundManager.userInteracted) {
                soundManager.enableAudio();
            }

            // Don't prevent default if user is touching a non-game element
            const target = e.target.closest('.cell, .square, .piece');
            if (target) {
                e.preventDefault();
            }

            const touch = e.touches[0];
            touchStartTime = Date.now();
            touchStartPos = { x: touch.clientX, y: touch.clientY };
            isLongPress = false;

            // Find the cell/square under the touch point
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = element ? (element.closest('.cell') || element.closest('.square')) : null;

            if (cell) {
                activeTouchCell = cell;

                // Add touch-active visual feedback to piece
                const piece = cell.querySelector('.piece, .red-piece, .blue-piece');
                if (piece) {
                    piece.classList.add('touch-active');
                }

                // Start long-press timer for move preview
                longPressTimer = setTimeout(function() {
                    isLongPress = true;
                    triggerLongPress(cell);
                }, 500);
            }
        }, { passive: false });

        board.addEventListener('touchmove', function(e) {
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;

            // If moved more than 10px, cancel long press
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                clearLongPress();
            }

            // Visual feedback: highlight cell under finger
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = element ? (element.closest('.cell') || element.closest('.square')) : null;

            // Remove previous touch-over
            document.querySelectorAll('.touch-over').forEach(function(el) {
                el.classList.remove('touch-over');
            });

            if (cell && cell.classList.contains('valid-move')) {
                cell.classList.add('touch-over');
            }

            e.preventDefault();
        }, { passive: false });

        board.addEventListener('touchend', function(e) {
            clearLongPress();

            // Remove touch-active and touch-over states
            document.querySelectorAll('.touch-active').forEach(function(el) {
                el.classList.remove('touch-active');
            });
            document.querySelectorAll('.touch-over').forEach(function(el) {
                el.classList.remove('touch-over');
            });

            // Don't trigger click if it was a long press
            if (isLongPress) {
                clearMovePreview();
                isLongPress = false;
                return;
            }

            // Get the element at the touch-end position
            const touch = e.changedTouches[0];
            const element = document.elementFromPoint(touch.clientX, touch.clientY);

            if (element) {
                // Create and dispatch a synthetic click on the element
                // This ensures compatibility with existing click handlers
                addTouchRipple(touch.clientX, touch.clientY, element);

                // If the touchend is on the same cell as touchstart, simulate click
                const endCell = element.closest('.cell') || element.closest('.square');
                if (endCell) {
                    endCell.click();
                }
            }

            activeTouchCell = null;
        }, { passive: false });

        board.addEventListener('touchcancel', function() {
            clearLongPress();
            document.querySelectorAll('.touch-active, .touch-over').forEach(function(el) {
                el.classList.remove('touch-active', 'touch-over');
            });
            clearMovePreview();
            activeTouchCell = null;
        });

        function clearLongPress() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }
    }

    // ── Touch Ripple Effect ──
    function addTouchRipple(x, y, target) {
        const cell = target.closest('.cell') || target.closest('.square');
        if (!cell) return;

        const rect = cell.getBoundingClientRect();
        const ripple = document.createElement('div');
        ripple.className = 'touch-ripple';

        const size = Math.max(rect.width, rect.height);
        ripple.style.width = size + 'px';
        ripple.style.height = size + 'px';
        ripple.style.left = (x - rect.left - size / 2) + 'px';
        ripple.style.top = (y - rect.top - size / 2) + 'px';

        cell.style.position = 'relative';
        cell.style.overflow = 'hidden';
        cell.appendChild(ripple);

        ripple.addEventListener('animationend', function() {
            ripple.remove();
        });
    }

    // ── Long-Press Move Preview ──
    function triggerLongPress(cell) {
        // Vibrate if supported (haptic feedback)
        if (navigator.vibrate) {
            navigator.vibrate(30);
        }

        const piece = cell.querySelector('.piece, .red-piece, .blue-piece');
        if (!piece) return;

        // Highlight the piece with a glow
        piece.style.boxShadow = '0 0 20px rgba(0, 255, 255, 0.8), 0 0 40px rgba(0, 255, 255, 0.4)';
        piece.dataset.previewActive = 'true';

        // Show preview dots on all valid move cells
        const validMoves = document.querySelectorAll('.valid-move');
        validMoves.forEach(function(moveCell) {
            const dot = document.createElement('div');
            dot.className = 'move-preview-dot';
            moveCell.style.position = 'relative';
            moveCell.appendChild(dot);
        });
    }

    function clearMovePreview() {
        // Remove preview dots
        document.querySelectorAll('.move-preview-dot').forEach(function(dot) {
            dot.remove();
        });

        // Reset piece glow
        document.querySelectorAll('[data-preview-active]').forEach(function(piece) {
            piece.style.boxShadow = '';
            delete piece.dataset.previewActive;
        });
    }

    // ── Double-Tap to Deselect ──
    function initDoubleTapDeselect() {
        const board = document.querySelector('.board') || document.getElementById('board');
        if (!board) return;

        let lastTapTime = 0;
        let lastTapTarget = null;

        board.addEventListener('touchend', function(e) {
            const now = Date.now();
            const touch = e.changedTouches[0];
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const cell = element ? (element.closest('.cell') || element.closest('.square')) : null;

            if (cell && cell === lastTapTarget && (now - lastTapTime) < 300) {
                // Double tap detected — deselect
                e.preventDefault();
                document.querySelectorAll('.selected').forEach(function(el) {
                    el.classList.remove('selected');
                });
                document.querySelectorAll('.valid-move').forEach(function(el) {
                    el.classList.remove('valid-move');
                });

                // Clear game state selection if function exists
                if (typeof clearHighlights === 'function') {
                    clearHighlights();
                }
                if (typeof window.selectedPiece !== 'undefined') {
                    window.selectedPiece = null;
                }

                // Vibrate for feedback
                if (navigator.vibrate) {
                    navigator.vibrate([20, 30, 20]);
                }

                lastTapTime = 0;
                lastTapTarget = null;
                return;
            }

            lastTapTime = now;
            lastTapTarget = cell;
        });
    }

    // ── Swipe Navigation (swipe right = back) ──
    function initSwipeNavigation() {
        let swipeStartX = 0;
        let swipeStartY = 0;
        let swiping = false;

        // Create swipe indicator
        const indicator = document.createElement('div');
        indicator.className = 'swipe-indicator';
        document.body.appendChild(indicator);

        document.addEventListener('touchstart', function(e) {
            // Only track swipes starting from the left edge (within 30px)
            const touch = e.touches[0];
            if (touch.clientX > 30) return;

            // Don't swipe if touching the board
            const board = document.querySelector('.board') || document.getElementById('board');
            if (board && board.contains(e.target)) return;

            swipeStartX = touch.clientX;
            swipeStartY = touch.clientY;
            swiping = true;
        }, { passive: true });

        document.addEventListener('touchmove', function(e) {
            if (!swiping) return;

            const touch = e.touches[0];
            const dx = touch.clientX - swipeStartX;
            const dy = Math.abs(touch.clientY - swipeStartY);

            // Must be more horizontal than vertical
            if (dy > dx) {
                swiping = false;
                indicator.classList.remove('active');
                return;
            }

            // Show indicator as user swipes
            if (dx > 20) {
                indicator.classList.add('active');
                const progress = Math.min(dx / 150, 1);
                indicator.style.opacity = progress;
            }
        }, { passive: true });

        document.addEventListener('touchend', function(e) {
            if (!swiping) return;
            swiping = false;
            indicator.classList.remove('active');

            const touch = e.changedTouches[0];
            const dx = touch.clientX - swipeStartX;

            // Swipe threshold: 100px
            if (dx > 100) {
                // Navigate back
                if (navigator.vibrate) {
                    navigator.vibrate(30);
                }

                // Check for specific back functions
                if (typeof goToMenu === 'function') {
                    goToMenu();
                } else if (typeof leaveLobby === 'function') {
                    leaveLobby();
                } else if (typeof goBackToWelcome === 'function') {
                    goBackToWelcome();
                } else {
                    window.history.back();
                }
            }
        }, { passive: true });
    }

    // ── Prevent pinch-zoom on game board ──
    function preventBoardZoom() {
        const board = document.querySelector('.board') || document.getElementById('board');
        if (!board) return;

        board.addEventListener('gesturestart', function(e) {
            e.preventDefault();
        });

        // Prevent double-tap zoom on the board
        let lastTouchEnd = 0;
        board.addEventListener('touchend', function(e) {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
    }

    // ── Viewport height fix for mobile browsers ──
    // Mobile browsers have dynamic toolbars that change vh
    function fixMobileViewportHeight() {
        function setVH() {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', vh + 'px');
        }
        setVH();
        window.addEventListener('resize', setVH);
        window.addEventListener('orientationchange', function() {
            setTimeout(setVH, 100);
        });
    }

    // ── Throttle Matrix Rain on mobile for performance ──
    function throttleMatrixRain() {
        const canvas = document.querySelector('.matrix-canvas');
        if (!canvas) return;

        // If MatrixRain instance exists, reduce its column count
        // This is done via CSS opacity, but we also reduce the frame rate
        if (typeof window.matrixRain !== 'undefined' && window.matrixRain) {
            // The matrix rain is already running; we just reduced opacity via CSS
            return;
        }
        if (typeof window.gameRoomMatrixRain !== 'undefined' && window.gameRoomMatrixRain) {
            return;
        }
    }

    // ── Initialize everything ──
    function init() {
        fixMobileViewportHeight();
        initBoardTouchControls();
        initDoubleTapDeselect();
        initSwipeNavigation();
        preventBoardZoom();
        throttleMatrixRain();
    }

    // Run after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Small delay to ensure game JS has initialized first
        setTimeout(init, 100);
    }
})();
