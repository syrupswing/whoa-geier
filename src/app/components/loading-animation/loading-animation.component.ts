import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading-animation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loading-animation.component.html',
  styleUrls: ['./loading-animation.component.scss']
})
export class LoadingAnimationComponent {
  size = input<number>(48);
}
