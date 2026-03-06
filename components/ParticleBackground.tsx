'use client';

import React, { useEffect, useRef } from 'react';

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    alpha: number;
    targetAlpha: number;
    type: 'star' | 'dust'; // 'dust' is the texture
}

export function ParticleBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let particles: Particle[] = [];
        let mouseX = -1000;
        let mouseY = -1000;

        // Monochrome "High-End" Palette
        // Just whites with varying opacity
        const colors = [
            '255, 255, 255', // Pure White
            '200, 200, 200', // Light Grey
        ];

        // Resize logic using ResizeObserver for robust sizing
        const handleResize = (entries: ResizeObserverEntry[]) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                // Double resolution for crispness on high-DPI screens, then scale down with CSS? 
                // Let's stick to 1:1 for perf, but make sure it matches.
                canvas.width = width;
                canvas.height = height;
                initParticles();
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);

        // Initial setup
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        const initParticles = () => {
            particles = [];
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const exclusionRadius = 220; // Reduced to match smaller text loop

            // 1. DUST TEXTURE (The "Noise")
            // Thousands of tiny faint dots to create texture
            const dustCount = Math.floor((canvas.width * canvas.height) / 800);
            for (let i = 0; i < dustCount; i++) {
                let x, y, dist;
                let attempts = 0;
                // Try to spawn outside the exclusion zone
                do {
                    x = Math.random() * canvas.width;
                    y = Math.random() * canvas.height;
                    dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
                    attempts++;
                } while (dist < exclusionRadius && attempts < 10);

                particles.push({
                    x, y,
                    vx: (Math.random() - 0.5) * 0.02, // Almost static
                    vy: (Math.random() - 0.5) * 0.02,
                    size: Math.random() * 1.0, // Reduced from 1.5
                    color: '255, 255, 255',
                    alpha: Math.random() * 0.15, // Very faint
                    targetAlpha: Math.random() * 0.15,
                    type: 'dust'
                });
            }

            // 2. STARS (The Main Actors)
            const starCount = Math.floor((canvas.width * canvas.height) / 4000);
            for (let i = 0; i < starCount; i++) {
                let x, y, dist;
                let attempts = 0;
                do {
                    x = Math.random() * canvas.width;
                    y = Math.random() * canvas.height;
                    dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
                    attempts++;
                } while (dist < exclusionRadius && attempts < 10);

                particles.push({
                    x, y,
                    vx: (Math.random() - 0.5) * 0.15,
                    vy: (Math.random() - 0.5) * 0.15,
                    size: Math.random() * 1.2 + 0.3, // Reduced from 2.0+0.5
                    color: colors[Math.floor(Math.random() * colors.length)],
                    alpha: Math.random() * 0.8 + 0.2, // Bright
                    targetAlpha: Math.random() * 0.8 + 0.2,
                    type: 'star'
                });
            }
        };

        initParticles();

        const update = () => {
            if (!ctx) return;

            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const exclusionRadius = 220;

            // Clear - Pure Black
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            particles.forEach((p) => {
                // Movement
                p.x += p.vx;
                p.y += p.vy;

                // 1. EXCLUSION ZONE REPELLENT (Keep text clear)
                const distToCenter = Math.sqrt(Math.pow(p.x - centerX, 2) + Math.pow(p.y - centerY, 2));
                if (distToCenter < exclusionRadius) {
                    const angle = Math.atan2(p.y - centerY, p.x - centerX);
                    const force = (exclusionRadius - distToCenter) / exclusionRadius;
                    // Strong gentle push outward
                    p.vx += Math.cos(angle) * force * 0.05;
                    p.vy += Math.sin(angle) * force * 0.05;
                }

                // 2. Mouse Interaction relative to viewport
                const dx = mouseX - p.x;
                const dy = mouseY - p.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const maxDist = 250;

                if (distance < maxDist && p.type === 'star') { // Only stars react strongly
                    const force = (maxDist - distance) / maxDist;
                    const angle = Math.atan2(dy, dx);

                    // Gentle push away
                    p.vx -= Math.cos(angle) * force * 0.02;
                    p.vy -= Math.sin(angle) * force * 0.02;
                }

                // Friction
                p.vx *= 0.99;
                p.vy *= 0.99;

                // Wrap
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;

                // Twinkle for stars only
                if (p.type === 'star') {
                    if (Math.random() > 0.99) {
                        p.targetAlpha = Math.random() * 0.8 + 0.2;
                    }
                    p.alpha += (p.targetAlpha - p.alpha) * 0.05;
                }

                // Draw
                ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            });

            animationFrameId = requestAnimationFrame(update);
        };

        const handleMouseMove = (e: MouseEvent) => {
            // Since fixed, clientX/Y map directly to canvas 0,0 usually, 
            // but let's be safe and use getBoundingClientRect if there's any offset (unlikely with fixed inset-0).
            mouseX = e.clientX;
            mouseY = e.clientY;
        };

        const handleMouseLeave = () => {
            mouseX = -1000;
            mouseY = -1000;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        update();

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <div ref={containerRef} className="fixed inset-0 z-0 bg-black pointer-events-none transition-opacity duration-1000 fade-in">
            <canvas ref={canvasRef} className="block w-full h-full" />
            {/* Optional Grain Overlay via CSS if we wanted, but canvas dust is cleaner. */}
        </div>
    );
}
