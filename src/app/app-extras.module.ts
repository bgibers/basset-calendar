import {
  NgModule
} from '@angular/core';

import {
  AppSkyModule
} from './app-sky.module';

import { MatDatepickerModule } from '@angular/material/datepicker'
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule} from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { BrowserAnimationsModule} from '@angular/platform-browser/animations';
import { MatIconModule} from '@angular/material/icon';
import { SkyProgressIndicatorModule } from '@skyux/progress-indicator';
import { SkyModalModule } from '@skyux/modals';
import { SkyFileAttachmentsModule } from '@skyux/forms';

@NgModule({
  exports: [
    AppSkyModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    BrowserAnimationsModule,
    MatIconModule,
    SkyModalModule,
    SkyProgressIndicatorModule,
    SkyFileAttachmentsModule
  ],
  imports: [
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    BrowserAnimationsModule,
    MatIconModule
  ],
  providers: [
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    BrowserAnimationsModule,
    MatIconModule
  ]
})
export class AppExtrasModule { }
