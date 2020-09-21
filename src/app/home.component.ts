import {
  Component, OnInit
} from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { SkyProgressIndicatorChange } from '@skyux/progress-indicator';
import {
  SkyFileItem,
  SkyFileAttachmentChange
} from '@skyux/forms';
import { HttpService } from './services/http-service.service';
import { SkyWaitService } from '@skyux/indicators';
import { take } from 'rxjs/operators';
import { IPayPalConfig, ICreateOrderRequest } from 'ngx-paypal';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'my-home',
  templateUrl: './home.component.html',
  styleUrls: ['home.component.scss']
})
export class HomeComponent implements OnInit {
  public filter: (d: Date | null) => boolean;
  public postCheckoutText: string;

  public get requirementsMet(): boolean {
    switch (this.activeIndex) {
      case 0:
        return this.date !== undefined;
      case 1:
        return this.dogForm.valid && this.fileValue !== undefined;
      case 2:
        return this.ownerForm.valid;
      default:
        return false;
    }
  }
  public ownerForm: FormGroup;
  public dogForm: FormGroup;
  public currentYear = new Date().getFullYear();
  public date: Date = undefined;
  public minDate = new Date();
  public maxDate = new Date();
  public activeIndex = 0;
  public fileValue: SkyFileItem;
  public templateUploadError: string;
  public maxFileSize: number = 4000000;
  public acceptedTypes: string = 'image/png,image/jpeg';
  public datesTaken: {[key: string]: string[]; } = {};
  public yearForSelecting = (new Date().getFullYear() + 1).toString();
  public payPalConfig: IPayPalConfig;
  public checkout = false;
  public postCheckout = false;
  public numCals: number;
  constructor(public httpService: HttpService, public waitSvc: SkyWaitService) {
    this.minDate = new Date(this.currentYear + 1, 0, 1);
    this.maxDate = new Date(this.currentYear + 1, 11, 31);
  }

  public ngOnInit(): void {
    this.waitSvc.beginBlockingPageWait();
    this.fileValue = undefined;
    const ownerName = new FormControl('', Validators.required);
    const dogName = new FormControl('', Validators.required);
    const isRescue = new FormControl(false, Validators.required);
    const city = new FormControl('', Validators.required);
    const state = new FormControl('', Validators.required);
    const caption = new FormControl('', Validators.required);
    const email = new FormControl('', Validators.compose([
      Validators.required,
      Validators.pattern('[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,3}$')
    ]));

    this.dogForm = new FormGroup({
      dogName,
      isRescue,
      caption
    });

    this.ownerForm = new FormGroup({
      ownerName,
      city,
      state,
      email
    });
    this.initConfig();
    this.httpService.GetDatesTaken(this.yearForSelecting).pipe(take(1)).subscribe(dates => {
      this.datesTaken = dates;
      this.filter = (d: Date | null): boolean => {
      const month = (d || new Date()).getMonth() + 1;
      const date = (d || new Date()).getDate().toString();
      const year = (d || new Date()).getFullYear().toString();

      if (this.yearForSelecting === year && this.datesTaken[month] && this.datesTaken[month].includes(date)) {
         return false;
      }
      return true;
    };
      this.waitSvc.endBlockingPageWait();
    });
  }

  public updateIndex(changes: SkyProgressIndicatorChange): void {
    this.activeIndex = changes.activeIndex;  }

  public filesUpdated(result: SkyFileAttachmentChange): void {
    const file = result.file;

    if (file && file.errorType) {
      this.fileValue = undefined;
      this.templateUploadError = this.getErrorMessage(file.errorType, file.errorParam);

    } else {
      this.fileValue = file;
      this.templateUploadError = undefined;
    }
  }

  public validateFile(file: SkyFileItem) {

  }

  public submitForm() {
    this.checkout = true;
  }

  private getErrorMessage(errorType: string, errorParam: string): string {
    if (errorType === 'fileType') {
      return `Please upload a file of type ${errorParam}.`;
    } else if (errorType === 'maxFileSize') {
      return `Please upload a file smaller than ${errorParam} KB.`;
    } else {
      return errorParam;
    }
  }

  private initConfig(): void {
    this.payPalConfig = {
        currency: 'USD',
        clientId: 'AeVrUujAwn-me2pUdRlPANmADsETUI9qAZYkd9WIBvovYyoPTH2SnCG_DA8qyIefRBJg2mBdOZpDuGSV',
        createOrderOnClient: (data) => <ICreateOrderRequest> {
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'USD',
                    value: '29.99',
                    breakdown: {
                        item_total: {
                            currency_code: 'USD',
                            value: '29.99'
                        }
                    }
                },
                items: [{
                    name: `BaRCSE calendar ${this.date}`,
                    quantity: '1',
                    category: 'PHYSICAL_GOODS',
                    unit_amount: {
                        currency_code: 'USD',
                        value: '29.99'
                    }
                }]
            }]
        },
        advanced: {
            commit: 'true'
        },
        style: {
            label: 'paypal',
            layout: 'vertical'
        },
        onApprove: (data, actions) => {
            console.log('onApprove - transaction was approved, but not authorized', data, actions);
            actions.order.get().then((details: any) => {
                console.log('onApprove - you can get full order details inside onApprove: ', details);
            });

        },
        onClientAuthorization: (data) => {
          this.waitSvc.beginBlockingPageWait();
          console.log('onClientAuthorization - you should probably inform your server about completed transaction at this point', data);
          this.httpService.UploadToServer(this.fileValue.file, this.ownerForm, this.dogForm, this.date).pipe(take(1)).subscribe(() => {
            this.postCheckout = true;
            this.checkout = false;
            this.postCheckoutText = 'Thank you for your order!';
          }, (err: HttpErrorResponse) => {
            if (err.status === 200) {
              this.postCheckout = true;
              this.checkout = false;
              this.postCheckoutText = 'Thank you for your order!';
              this.waitSvc.endBlockingPageWait();
            }
          }, () => {
            this.waitSvc.endBlockingPageWait();
          });
        },
        onCancel: (data, actions) => {
            console.log('OnCancel', data, actions);
            this.postCheckout = true;
            this.checkout = false;
            this.postCheckoutText = 'Order successfully canceled.';
        },
        onError: err => {
            console.log('OnError', err);
            this.postCheckout = true;
            this.checkout = false;
            this.postCheckoutText = `Paypal could not process your order try again. ERROR ${err}`;
        },
        onClick: (data, actions) => {
            console.log('onClick', data, actions);
            // this.resetStatus();
        }
    };
  }
}
