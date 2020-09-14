import {HttpClient, HttpParams} from '@angular/common/http';
import * as _ from 'lodash';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { FormGroup } from '@angular/forms';

@Injectable()
export class HttpService {

  public months = new Array();
  public datesTaken: { [key: string]: string[]; } = {};

  constructor(private httpClient: HttpClient) {
    this.months.push('January', 'February', 'March', 'April', 'May',
    'June', 'July', 'August', 'September', 'October', 'November', 'December');
  }

  public GetDatesTaken(year: string) {
    let index = 0;
    this.months.forEach(month => {
      const monthIndex = index + 1;
      this.datesTaken[monthIndex] = [];
      const params = new HttpParams({fromString: `month=${month}&year=${year}`});
      this.httpClient.get<[]>('https://www.barcsebasset-a-daycalendar.org/fs/datestaken', {params}).subscribe(dates => {
        this.datesTaken[monthIndex] = dates;
      });
      index ++;
    });
    return new BehaviorSubject(this.datesTaken);
  }

  public UploadToServer(file: File, ownerForm: FormGroup, petForm: FormGroup, date: Date): Observable<Object> {
    let formData = new FormData();
    formData.append('ownerName', ownerForm.controls.ownerName.value);
    formData.append('city', ownerForm.controls.city.value);
    formData.append('state', ownerForm.controls.state.value);
    formData.append('email', ownerForm.controls.email.value);
    formData.append('dogName', petForm.controls.dogName.value);
    formData.append('isRescue', petForm.controls.isRescue.value);
    formData.append('caption', petForm.controls.caption.value);
    formData.append('image', file);

    const params = new HttpParams({fromString: `month=${this.months[date.getMonth()]}&year=${date.getFullYear()}&date=${date.getDate()}`});

    return this.httpClient.post('https://www.barcsebasset-a-daycalendar.org/fs/upload', formData, {params});
  }
}
