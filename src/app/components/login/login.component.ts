import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import { LoadingAnimationComponent } from '../loading-animation/loading-animation.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    LoadingAnimationComponent
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  email = signal<string>('');
  password = signal<string>('');
  isLoading = signal<boolean>(false);
  errorMessage = signal<string>('');

  constructor(public authService: AuthService, private router: Router) {}

  async onSubmit(): Promise<void> {
    if (!this.email().trim() || !this.password().trim()) {
      this.errorMessage.set('Please enter both email and password');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      await this.authService.signInWithEmail(this.email(), this.password());
      // Navigate to dashboard on successful login
      this.router.navigate(['/']);
    } catch (error: any) {
      this.errorMessage.set(error.message);
    } finally {
      this.isLoading.set(false);
    }
  }
}
