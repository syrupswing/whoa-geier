import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavDrawerService } from '../nav-drawer/nav-drawer.service';

@Component({
  selector: 'app-global-nav-menu',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule
  ],
  templateUrl: './global-nav-menu.component.html',
  styleUrl: './global-nav-menu.component.scss',
  host: { '[class.drawer-open]': 'drawer.isOpen()' }
})
export class GlobalNavMenuComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly drawer = inject(NavDrawerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Horizontal position of the fixed button: the column its slot in the page header sits in. */
  left = signal(0);

  private frame = 0;

  constructor() {
    // The page slides sideways while the drawer opens, which would skew a measurement taken then;
    // measure again once it has settled back.
    effect(() => {
      if (!this.drawer.isOpen()) setTimeout(() => this.measure(), 350);
    });
  }

  ngOnInit(): void {
    window.addEventListener('resize', this.scheduleMeasure);
    this.scheduleMeasure();
  }

  ngAfterViewInit(): void {
    // Straight away, so the first paint already has the button in its place.
    this.measure();
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.scheduleMeasure);
    cancelAnimationFrame(this.frame);
  }

  private scheduleMeasure = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  };

  /**
   * The button is always fixed at the top of the screen, so scrolling never moves it. Its slot in the
   * header keeps the 46px footprint (the layout is unchanged), and only the slot's column matters: that
   * is where the button is placed. Scrolling changes the slot's top, never its left, so nothing
   * listens to scroll.
   */
  private measure(): void {
    const left = this.host.nativeElement.getBoundingClientRect().left;
    if (left !== this.left()) this.left.set(left);
  }
}
