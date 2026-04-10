# Concept

--- 
**Goal**: Create modular scrape tool to mass scrape any website. 
**Description**: This project will contain these files; 
main.js: Main file will make all the other file elements comes together. 
scrape.js: It will contain one class of "Scrape" which will take json file which contains the URL, css elements and pagination elements if there is.
           The class will use this file to extract the elements almost any websites, it should modular where I can add or remove features without 
          reprucussions. Current functions it will contain is; find, findAll, pagination, getAttr, scrapeGroup, scrapeField, scrape, delay, captchaDetection
          captchaHandler.
exporter.js: It handles the data and export into various forms like json, csv and excel. It should have empty function where we write a scripts to format to our
             liking. Making it more specific for any project.
logging.js: This simple file creates a class that logs anything from info, warning and error. It should be saved in file and viewed in terminal when running the 
            program.

--- 
## Idea
I have idea of creating website where I can interact with my scraper tool. I want to able to create elements for json file, see the scraped info and all the errors.
Website will have dashboard where I can monitor all my scrapes, create new scrape task maybe in future I can make automate scrape to extract at certain time of the day.

