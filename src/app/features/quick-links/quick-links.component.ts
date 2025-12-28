import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';

export interface QuickLink {
  id: number;
  title: string;
  url: string;
  icon: string;
  category: string;
  color: string;
}

@Component({
  selector: 'app-quick-links',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule
  ],
  templateUrl: './quick-links.component.html',
  styleUrls: ['./quick-links.component.scss']
})
export class QuickLinksComponent {
  links: QuickLink[] = [
    {
      id: 1,
      title: 'School Portal',
      url: 'https://school.example.com',
      icon: 'school',
      category: 'School',
      color: '#2196F3'
    },
    {
      id: 2,
      title: 'Lunch Menu',
      url: 'https://school.example.com/lunch',
      icon: 'restaurant',
      category: 'School',
      color: '#4CAF50'
    },
    {
      id: 3,
      title: 'Library Resources',
      url: 'https://library.example.com',
      icon: 'local_library',
      category: 'Education',
      color: '#9C27B0'
    },
    {
      id: 4,
      title: 'Sports Schedule',
      url: 'https://sports.example.com',
      icon: 'sports_soccer',
      category: 'Activities',
      color: '#FF5722'
    },
    {
      id: 5,
      title: 'Music Lessons',
      url: 'https://music.example.com',
      icon: 'music_note',
      category: 'Activities',
      color: '#FF9800'
    }
  ];

  categories: string[] = ['All', 'School', 'Education', 'Activities'];
  selectedCategory = 'All';

  getFilteredLinks(): QuickLink[] {
    if (this.selectedCategory === 'All') {
      return this.links;
    }
    return this.links.filter(link => link.category === this.selectedCategory);
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
  }

  openLink(url: string): void {
    window.open(url, '_blank');
  }
}
