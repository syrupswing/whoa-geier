import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home-logo-btn',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home-logo-btn.component.html',
  styleUrl: './home-logo-btn.component.scss'
})
export class HomeLogoBtnComponent {}
