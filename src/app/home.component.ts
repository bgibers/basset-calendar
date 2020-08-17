import {
  Component, OnInit
} from '@angular/core';
import { FormGroup, FormControl, Validators } from '@angular/forms';
import { SkyProgressIndicatorChange } from '@skyux/progress-indicator';
import {
  SkyFileDropChange,
  SkyFileItem,
  SkyFileLink
} from '@skyux/forms';
import { HttpService } from './services/http-service.service';
import { SkyWaitService } from '@skyux/indicators';
import { take } from 'rxjs/operators';
import { IPayPalConfig, ICreateOrderRequest } from 'ngx-paypal';

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
        return this.dogForm.valid && this.filesToUpload.length > 0;
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
  public filesToUpload: SkyFileItem[];
  public allItems: (SkyFileItem | SkyFileLink)[];
  public linksToUpload: SkyFileLink[];
  public rejectedFiles: SkyFileItem[];
  public maxFileSize: number = 4000000;
  public acceptedTypes: string = 'image/png,image/jpeg';
  public datesTaken: {[key: string]: string[]; } = {};
  public yearForSelecting = (new Date().getFullYear() + 1).toString();
  public payPalConfig: IPayPalConfig;
  public checkout = false;
  public postCheckout = false;
  constructor(public httpService: HttpService, public waitSvc: SkyWaitService) {
    this.minDate = new Date(this.currentYear + 1, 0, 1);
    this.maxDate = new Date(this.currentYear + 1, 11, 31);

    this.filesToUpload = [];
    this.rejectedFiles = [];
    this.allItems = [];
    this.linksToUpload = [];
  }

  public ngOnInit(): void {
    this.waitSvc.beginBlockingPageWait();
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
    this.activeIndex = changes.activeIndex;
  }

  public filesUpdated(result: SkyFileDropChange) {
    this.filesToUpload = this.filesToUpload.concat(result.files);
    console.log(this.filesToUpload);

    this.rejectedFiles = this.rejectedFiles.concat(result.rejectedFiles);
    this.allItems = this.allItems.concat(result.files);
  }

  public linkAdded(result: SkyFileLink) {
    this.linksToUpload = this.linksToUpload.concat(result);
    this.allItems = this.allItems.concat(result);
  }

  public validateFile(file: SkyFileItem) {
    if (file.file.name.indexOf('a') === 0) {
      return 'You may not upload a file that begins with the letter "a."';
    }
  }

  public deleteFile(file: SkyFileItem | SkyFileLink) {
    this.removeFromArray(this.allItems, file);
    this.removeFromArray(this.filesToUpload, file);
    this.removeFromArray(this.linksToUpload, file);
  }

  public submitForm() {
    this.checkout = true;
  }

  private removeFromArray(items: any[], obj: SkyFileItem | SkyFileLink) {
    if (items) {
      const index = items.indexOf(obj);

      if (index !== -1) {
        items.splice(index, 1);
      }
    }
  }

  private initConfig(): void {
    this.payPalConfig = {
        currency: 'USD',
        clientId: 'sb',
        createOrderOnClient: (data) => <ICreateOrderRequest> {
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'USD',
                    value: '9.99',
                    breakdown: {
                        item_total: {
                            currency_code: 'USD',
                            value: '9.99'
                        }
                    }
                },
                items: [{
                    name: 'BaRCSE calendar',
                    quantity: '1',
                    category: 'PHYSICAL_GOODS',
                    unit_amount: {
                        currency_code: 'USD',
                        value: '9.99'
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
          this.httpService.UploadToServer(this.filesToUpload[0].file, this.ownerForm, this.dogForm, this.date);
          this.waitSvc.endBlockingPageWait();
          this.postCheckout = true;
          this.checkout = false;
          this.postCheckoutText = 'Thank you for your order!';
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
