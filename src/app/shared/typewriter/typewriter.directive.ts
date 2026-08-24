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

  /** Milliseconds between characters. */
  @Input() typewriterSpeed = 18;

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
    this.zone.runOutsideAngular(() => {
      this.timer = window.setInterval(() => {
        index++;
        node.textContent = text.slice(0, index);
        if (index >= text.length) {
          this.stop();
        }
      }, this.typewriterSpeed);
    });
  }

  private stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
