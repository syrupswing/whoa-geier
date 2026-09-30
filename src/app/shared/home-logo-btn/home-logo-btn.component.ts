import { Component, input } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';

@Component({
  selector: 'app-home-logo-btn',
  standalone: true,
  imports: [NgIf, RouterLink, LoadingAnimationComponent],
  templateUrl: './home-logo-btn.component.html',
  styleUrl: './home-logo-btn.component.scss'
})
export class HomeLogoBtnComponent {
  /** Swaps the static logo for the animated loader while the page is still getting ready. */
  loading = input<boolean>(false);
}
