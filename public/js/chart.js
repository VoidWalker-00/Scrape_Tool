// chart.js — sparkline bar chart renderer.
//
// Usage:
//   const sparkline = new Sparkline();
//   container.appendChild(sparkline.el);
//   sparkline.draw([{ count: 10, status: 'success' }, { count: 0, status: 'error' }]);
//
// Each bar = one run. Height ∝ items scraped. Color = green (success) / orange (error).
// Bars are 40% opacity so text layered above the canvas stays readable.

export class Sparkline {
  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'sparkline';
  }

  // Resize canvas to match its rendered container, then draw.
  // Call after el is in the DOM so offsetWidth/offsetHeight are available.
  draw(data) {
    const canvas = this.el;
    canvas.width  = canvas.offsetWidth  || canvas.parentElement?.offsetWidth  || 200;
    canvas.height = canvas.offsetHeight || canvas.parentElement?.offsetHeight || 120;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!data || data.length === 0) return;

    const { width, height } = canvas;
    const maxCount = Math.max(...data.map(d => d.count), 1);
    const barWidth = width / data.length;
    const gap = 2;

    data.forEach((d, i) => {
      // Always draw at least a 2px nub if count > 0 so the bar is visible
      const barHeight = d.count > 0
        ? Math.max((d.count / maxCount) * height, 2)
        : 0;
      const x = i * barWidth;
      const y = height - barHeight;

      ctx.fillStyle = d.status === 'error'
        ? 'rgba(232, 125, 62, 0.4)'   // --orange
        : 'rgba(180, 210, 115, 0.4)'; // --green

      ctx.fillRect(x + gap / 2, y, barWidth - gap, barHeight);
    });
  }
}
