import { Directive, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SecurityContext, SimpleChanges, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';

/**
 * Reveals AI-generated text one character at a time.
 * Usage: <p [appTypewriter]="aiText()"></p>
 * Pass [typewriterMarkdown]="true" to render the revealed text as sanitized
 * markdown (bold, lists, paragraphs) instead of plain text — use this only for
 * open-ended chat prose, not the short single-phrase usages of this directive.
 * Pass [typewriterInstant]="true" to render the full text immediately with no
 * animation — use this for text the user has already seen typed out before
 * (e.g. chat history restored from persistence), so it doesn't replay on
 * every reload.
 */
@Directive({
  selector: '[appTypewriter]',
  standalone: true
})
export class TypewriterDirective implements OnChanges, OnDestroy {
  private readonly el: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly sanitizer = inject(DomSanitizer);
  private timer?: number;
  private currentText: string | null = null;
  /** Words left to reveal before the current no-pause burst ends. */
  private wordsUntilPause = 0;

  @Input() appTypewriter: string | null | undefined;

  /** Milliseconds between characters. */
  @Input() typewriterSpeed = 8;

  /** Milliseconds to pause on a space, so words reveal one at a time. */
  @Input() typewriterSpacePause = 55;

  /** Render the revealed text as sanitized markdown instead of plain text. */
  @Input() typewriterMarkdown = false;

  /** Skip the animation and render the full text immediately. */
  @Input() typewriterInstant = false;

  /** Shows a caret (the `tw-cursor` class) while text is being typed or erased. */
  @Input() typewriterCursor = false;

  /** When the text changes, backspace what's showing before typing the new text. */
  @Input() typewriterErase = false;

  /** Milliseconds between characters while erasing. */
  @Input() typewriterEraseSpeed = 14;

  /** Fires once the full text has been revealed (not while erasing the old text). */
  @Output() typewriterDone = new EventEmitter<void>();

  /** Fires when the previous text is gone — after erasing it, or right away when there's nothing to erase — just before the new text starts. */
  @Output() typewriterCleared = new EventEmitter<void>();

  /** Plain text currently on screen, so erasing starts from where a reveal was cut off. */
  private shown = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['appTypewriter']) return;
    const text = this.appTypewriter ?? '';
    if (text === this.currentText) return;
    this.currentText = text;
    if (this.canErase()) {
      this.erase(() => {
        this.zone.run(() => this.typewriterCleared.emit());
        this.reveal(text);
      });
    } else {
      // Deferred: this runs inside the parent's change detection, where a listener that
      // writes state the template already read would trip the dev-mode consistency check.
      queueMicrotask(() => this.typewriterCleared.emit());
      this.reveal(text);
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private prefersInstant(): boolean {
    return this.typewriterInstant || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  private canErase(): boolean {
    return this.typewriterErase && !this.typewriterMarkdown && !this.prefersInstant() && this.shown.length > 0;
  }

  private setCursor(on: boolean): void {
    if (this.typewriterCursor) {
      this.el.nativeElement.classList.toggle('tw-cursor', on);
    }
  }

  /** Backspaces whatever is showing, then calls onEmpty. */
  private erase(onEmpty: () => void): void {
    this.stop();
    const node = this.el.nativeElement;
    this.setCursor(true);
    this.zone.runOutsideAngular(() => {
      const step = () => {
        this.shown = this.shown.slice(0, -1);
        this.render(node, this.shown);
        if (this.shown.length === 0) {
          onEmpty();
          return;
        }
        this.timer = window.setTimeout(step, this.typewriterEraseSpeed);
      };
      this.timer = window.setTimeout(step, this.typewriterEraseSpeed);
    });
  }

  private reveal(text: string): void {
    this.stop();
    const node = this.el.nativeElement;
    this.shown = '';
    this.render(node, '');
    if (!text) {
      this.setCursor(false);
      return;
    }

    if (this.prefersInstant()) {
      this.shown = text;
      this.render(node, text);
      this.setCursor(false);
      this.zone.run(() => this.typewriterDone.emit());
      return;
    }

    this.setCursor(true);

    let index = 0;
    this.wordsUntilPause = this.randomBurstLength();
    this.zone.runOutsideAngular(() => {
      const step = () => {
        index++;
        this.shown = text.slice(0, index);
        this.render(node, this.shown);
        if (index >= text.length) {
          this.setCursor(false);
          this.zone.run(() => this.typewriterDone.emit());
          return;
        }
        // Pause on the space itself so the next word starts after a beat, not mid-reveal.
        const delay = text[index - 1] === ' ' ? this.spaceDelay() : this.typewriterSpeed;
        this.timer = window.setTimeout(step, delay);
      };
      this.timer = window.setTimeout(step, this.typewriterSpeed);
    });
  }

  private render(node: HTMLElement, text: string): void {
    if (!this.typewriterMarkdown) {
      node.textContent = text;
      return;
    }
    // Partial markdown mid-reveal (e.g. an unclosed "**") renders as literal
    // characters until the closing token arrives — self-corrects, same as any
    // streaming markdown renderer.
    const html = marked.parse(text, { breaks: true, async: false }) as string;
    node.innerHTML = this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
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
