import {
  NgModule
} from '@angular/core';

import {
  AppSkyModule
} from './app-sky.module';

import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule} from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { BrowserAnimationsModule} from '@angular/platform-browser/animations';
import { MatIconModule} from '@angular/material/icon';
import { SkyProgressIndicatorModule } from '@skyux/progress-indicator';
import { SkyModalModule } from '@skyux/modals';
import { SkyFileAttachmentsModule } from '@skyux/forms';
import { HttpClientModule } from '@angular/common/http';
import { HttpService } from './services/http-service.service';
import { SkyWaitModule } from '@skyux/indicators';
import { NgxPayPalModule } from 'ngx-paypal';
import { NgxEditorModule} from 'ngx-editor';
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
    SkyFileAttachmentsModule,
    SkyWaitModule,
    NgxPayPalModule,
    NgxEditorModule
    ],
  imports: [
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    BrowserAnimationsModule,
    MatIconModule,
    HttpClientModule,
    NgxPayPalModule,
    NgxEditorModule
  ],
  providers: [
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    BrowserAnimationsModule,
    MatIconModule,
    HttpService
    ]
})
export class AppExtrasModule { }
