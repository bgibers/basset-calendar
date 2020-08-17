import {
  NgModule
} from '@angular/core';

import {
  SkyAvatarModule
} from '@skyux/avatar';

import {
  SkyAlertModule,
  SkyKeyInfoModule,
  SkyWaitModule
} from '@skyux/indicators';

import {
  SkyFluidGridModule
} from '@skyux/layout';

import {
  SkyNavbarModule
} from '@skyux/navbar';
import { SkyCheckboxModule, SkyFileAttachmentsModule } from '@skyux/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule} from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {MatIconModule} from '@angular/material/icon';
import { SkyProgressIndicatorModule } from '@skyux/progress-indicator';
import { SkyModalModule } from '@skyux/modals';
import {HttpClientModule} from '@angular/common/http';
import { NgxPayPalModule } from 'ngx-paypal';
import { HttpService } from './services/http-service.service';
import { NgxEditorModule} from 'ngx-editor';

@NgModule({
  exports: [
    SkyAvatarModule,
    SkyAlertModule,
    SkyKeyInfoModule,
    SkyFluidGridModule,
    SkyNavbarModule,
    SkyCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    BrowserAnimationsModule,
    MatIconModule,
    SkyProgressIndicatorModule,
    SkyModalModule,
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
export class AppSkyModule { }
