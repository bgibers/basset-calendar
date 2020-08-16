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

@Component({
  selector: 'my-home',
  templateUrl: './home.component.html',
  styleUrls: ['home.component.scss']
})
export class HomeComponent implements OnInit {
  public ownerForm: FormGroup;
  public dogForm: FormGroup;
  public date: number = Date.now();
  public minDate = new Date(

  );

  public maxDate = new Date(

  );
  public activeIndex = 0;
  public filesToUpload: SkyFileItem[];
  public allItems: (SkyFileItem | SkyFileLink)[];
  public linksToUpload: SkyFileLink[];
  public rejectedFiles: SkyFileItem[];
  public maxFileSize: number = 4000000;
  public acceptedTypes: string = 'image/png,image/jpeg';

  constructor() {
    this.filesToUpload = [];
    this.rejectedFiles = [];
    this.allItems = [];
    this.linksToUpload = [];
  }

  public disabledDates = (date: Date): boolean => {
    return date.getDate() % 2 === 0;
  }

  public onlyWeekendsPredicate(date: Date) {
    let day = date.getDay();
    return day === 0 || day === 6;
  }

  public ngOnInit(): void {
    const ownerName = new FormControl('', Validators.required);
    const dogName = new FormControl('', Validators.required);
    const isRescue = new FormControl(false, Validators.required);
    const city = new FormControl('', Validators.required);
    const state = new FormControl('', Validators.required);
    const caption = new FormControl('', Validators.required);
    const email = new FormControl('', Validators.compose([
      Validators.required,
      Validators.pattern('[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,3}$')
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
  }

  public get requirementsMet(): boolean {
    switch (this.activeIndex) {
      case 0:
        return this.date > Date.now();
      case 1:
        return this.dogForm.valid && this.filesToUpload.length > 0;
      case 2:
        return this.ownerForm.valid;
      default:
        return false;
    }
  }

  public updateIndex(changes: SkyProgressIndicatorChange): void {
    this.activeIndex = changes.activeIndex;
  }

  public filesUpdated(result: SkyFileDropChange) {
    this.filesToUpload = this.filesToUpload.concat(result.files);
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

  private removeFromArray(items: any[], obj: SkyFileItem | SkyFileLink) {
    if (items) {
      const index = items.indexOf(obj);

      if (index !== -1) {
        items.splice(index, 1);
      }
    }
  }

  public submitForm() {

  }
}
