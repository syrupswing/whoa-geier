import { Directive, ElementRef, Input, NgZone, OnDestroy, inject } from '@angular/core';

/**
 * Reveals AI-generated text one character at a time.
 * Usage: <p [appTypewriter]="aiText()"></p>
 */
@Directive({
  selector: '[appTypewriter]',
  standalone: true
})
export class TypewriterDirective implements OnDestroy {
  private readonly el: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private timer?: number;
  private currentText: string | null = null;
  /** Words left to reveal before the current no-pause burst ends. */
  private wordsUntilPause = 0;

  /** Milliseconds between characters. */
  @Input() typewriterSpeed = 8;

  /** Milliseconds to pause on a space, so words reveal one at a time. */
  @Input() typewriterSpacePause = 55;

  @Input()
  set appTypewriter(value: string | null | undefined) {
    const text = value ?? '';
    if (text === this.currentText) return;
    this.currentText = text;
    this.reveal(text);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private reveal(text: string): void {
    this.stop();
    const node = this.el.nativeElement;
    node.textContent = '';
    if (!text) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = text;
      return;
    }

    let index = 0;
    this.wordsUntilPause = this.randomBurstLength();
    this.zone.runOutsideAngular(() => {
      const step = () => {
        index++;
        node.textContent = text.slice(0, index);
        if (index >= text.length) return;
        // Pause on the space itself so the next word starts after a beat, not mid-reveal.
        const delay = text[index - 1] === ' ' ? this.spaceDelay() : this.typewriterSpeed;
        this.timer = window.setTimeout(step, delay);
      };
      this.timer = window.setTimeout(step, this.typewriterSpeed);
    });
  }

  /**
   * Words stream out in fast, unbroken bursts (4-10 words); only once a burst
   * runs out does a beat land — occasionally a longer one, like the model
   * paused to "think" — mimics how AI text actually streams in.
   */
  private spaceDelay(): number {
    if (this.wordsUntilPause > 0) {
      this.wordsUntilPause--;
      return this.typewriterSpeed;
    }
    this.wordsUntilPause = this.randomBurstLength();
    const roll = Math.random();
    return roll < 0.7
      ? this.typewriterSpacePause * (0.6 + Math.random() * 0.8)
      : this.typewriterSpacePause * (2.5 + Math.random() * 2.5);
  }

  private randomBurstLength(): number {
    return 4 + Math.floor(Math.random() * 7); // 4-10 words
  }

  private stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
